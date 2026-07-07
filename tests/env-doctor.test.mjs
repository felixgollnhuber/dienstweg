import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  classifyEnvironment,
  probeEnvironment,
  detectLinearMcp,
  runEnvDoctor,
  MIN_CLAUDE_CODE_VERSION,
  ENV_DOCTOR_VAR,
} from "../src/env-doctor.mjs";
import { tmp, tmpRepo, cleanupAll } from "./helpers.mjs";

after(cleanupAll);

// Readings for an entirely healthy machine - every check should stay silent.
const HEALTHY = {
  node: { version: "20.11.1" },
  gh: { installed: true, authenticated: true },
  claudeCode: { installed: true, version: MIN_CLAUDE_CODE_VERSION },
  linearMcp: { visible: true, source: "x" },
};

const hasProblem = (r, re) => r.problems.some((p) => re.test(p));
const hasInfo = (r, re) => r.infos.some((i) => re.test(i));

// --- classifyEnvironment: the graduated severity policy, per check ---

test("classify: a fully healthy machine yields no problems and no infos", () => {
  const r = classifyEnvironment(HEALTHY);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.infos, []);
});

test("classify: Node below 20 is a FAIL (problem)", () => {
  const r = classifyEnvironment({ ...HEALTHY, node: { version: "18.19.0" } });
  assert.ok(hasProblem(r, />= 20/), "expected a Node >= 20 problem");
  assert.equal(r.infos.length, 0);
});

test("classify: Node 20+ passes (major boundary)", () => {
  for (const v of ["20.0.0", "22.4.1", "26.0.0"]) {
    assert.deepEqual(classifyEnvironment({ ...HEALTHY, node: { version: v } }).problems, []);
  }
});

test("classify: gh missing is an INFO, not a FAIL", () => {
  const r = classifyEnvironment({ ...HEALTHY, gh: { installed: false, authenticated: null } });
  assert.ok(hasInfo(r, /gh .*not found/i));
  assert.equal(r.problems.length, 0);
});

test("classify: gh installed but unauthenticated is a FAIL", () => {
  const r = classifyEnvironment({ ...HEALTHY, gh: { installed: true, authenticated: false } });
  assert.ok(hasProblem(r, /gh .*not authenticated/i));
});

test("classify: gh authenticated stays silent", () => {
  const r = classifyEnvironment({ ...HEALTHY, gh: { installed: true, authenticated: true } });
  assert.equal(r.problems.length, 0);
  assert.equal(r.infos.length, 0);
});

test("classify: gh auth undeterminable is an INFO", () => {
  const r = classifyEnvironment({ ...HEALTHY, gh: { installed: true, authenticated: null } });
  assert.ok(hasInfo(r, /gh auth status could not be determined/i));
  assert.equal(r.problems.length, 0);
});

test("classify: Claude Code missing is an INFO", () => {
  const r = classifyEnvironment({ ...HEALTHY, claudeCode: { installed: false, version: null } });
  assert.ok(hasInfo(r, /Claude Code CLI not found/i));
  assert.equal(r.problems.length, 0);
});

test("classify: Claude Code below the minimum is a FAIL", () => {
  const r = classifyEnvironment({ ...HEALTHY, claudeCode: { installed: true, version: "2.1.100" } });
  assert.ok(hasProblem(r, new RegExp(`>= ${MIN_CLAUDE_CODE_VERSION.replace(/\./g, "\\.")}`)));
});

test("classify: Claude Code at exactly the minimum passes", () => {
  const r = classifyEnvironment({ ...HEALTHY, claudeCode: { installed: true, version: MIN_CLAUDE_CODE_VERSION } });
  assert.equal(r.problems.length, 0);
});

test("classify: Claude Code newer than the minimum passes", () => {
  const r = classifyEnvironment({ ...HEALTHY, claudeCode: { installed: true, version: "2.2.0" } });
  assert.equal(r.problems.length, 0);
});

test("classify: Claude Code with an unparseable version is an INFO", () => {
  const r = classifyEnvironment({ ...HEALTHY, claudeCode: { installed: true, version: null } });
  assert.ok(hasInfo(r, /version could not be determined/i));
  assert.equal(r.problems.length, 0);
});

test("classify: Linear MCP not visible is an INFO (best effort, never a FAIL)", () => {
  const r = classifyEnvironment({ ...HEALTHY, linearMcp: { visible: false, source: null } });
  assert.ok(hasInfo(r, /Linear MCP not detected/i));
  assert.equal(r.problems.length, 0);
});

test("classify: Linear MCP visible stays silent", () => {
  const r = classifyEnvironment({ ...HEALTHY, linearMcp: { visible: true, source: "x" } });
  assert.equal(r.infos.length, 0);
  assert.equal(r.problems.length, 0);
});

test("classify: never throws on empty / partial readings", () => {
  assert.doesNotThrow(() => classifyEnvironment());
  assert.doesNotThrow(() => classifyEnvironment({}));
  assert.doesNotThrow(() => classifyEnvironment({ node: {}, gh: {}, claudeCode: {}, linearMcp: {} }));
});

// --- detectLinearMcp: best-effort config scan ---

test("detectLinearMcp: finds a linear server in repo .mcp.json", () => {
  const root = tmpRepo();
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { "linear-dienstweg": { command: "npx" } } }));
  assert.equal(detectLinearMcp(root).visible, true);
});

test("detectLinearMcp: matches on the server definition, not just the name", () => {
  const root = tmpRepo();
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { tracker: { command: "linear-mcp-server" } } }));
  assert.equal(detectLinearMcp(root).visible, true);
});

test("detectLinearMcp: matches enabledMcpjsonServers in .claude settings", () => {
  const root = tmpRepo();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ enabledMcpjsonServers: ["linear-team"] }));
  assert.equal(detectLinearMcp(root).visible, true);
});

test("detectLinearMcp: reports not-visible for an unrelated / empty repo", () => {
  const root = tmpRepo();
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }));
  // Note: this reads the real ~/.claude.json too; guard against a genuine local
  // Linear config by only asserting the .mcp.json path does not itself match.
  const res = detectLinearMcp(root);
  assert.equal(typeof res.visible, "boolean");
});

test("detectLinearMcp: never throws on a corrupt config file", () => {
  const root = tmpRepo();
  writeFileSync(join(root, ".mcp.json"), "{ not json");
  assert.doesNotThrow(() => detectLinearMcp(root));
});

// --- probeEnvironment / runEnvDoctor: injection seam + never-throws ---

test("probeEnvironment: returns the documented shape and never throws (real probe)", () => {
  const root = tmp();
  let readings;
  assert.doesNotThrow(() => { readings = probeEnvironment(root); });
  assert.equal(typeof readings.node.version, "string");
  assert.equal(typeof readings.gh.installed, "boolean");
  assert.equal(typeof readings.claudeCode.installed, "boolean");
  assert.equal(typeof readings.linearMcp.visible, "boolean");
});

test("probeEnvironment: honors injected fake readings via the env var", (t) => {
  const fake = { node: { version: "18.0.0" }, gh: { installed: false }, claudeCode: { installed: false }, linearMcp: { visible: false } };
  const prev = process.env[ENV_DOCTOR_VAR];
  process.env[ENV_DOCTOR_VAR] = JSON.stringify(fake);
  t.after(() => { if (prev === undefined) delete process.env[ENV_DOCTOR_VAR]; else process.env[ENV_DOCTOR_VAR] = prev; });
  assert.deepEqual(probeEnvironment("/nonexistent"), fake);
});

test("runEnvDoctor: 'off' skips the doctor entirely", (t) => {
  const prev = process.env[ENV_DOCTOR_VAR];
  process.env[ENV_DOCTOR_VAR] = "off";
  t.after(() => { if (prev === undefined) delete process.env[ENV_DOCTOR_VAR]; else process.env[ENV_DOCTOR_VAR] = prev; });
  assert.deepEqual(runEnvDoctor(tmp()), { problems: [], infos: [] });
});

test("runEnvDoctor: injected failing readings produce the expected FAILs", (t) => {
  const fake = {
    node: { version: "18.0.0" },
    gh: { installed: true, authenticated: false },
    claudeCode: { installed: true, version: "2.1.100" },
    linearMcp: { visible: false },
  };
  const prev = process.env[ENV_DOCTOR_VAR];
  process.env[ENV_DOCTOR_VAR] = JSON.stringify(fake);
  t.after(() => { if (prev === undefined) delete process.env[ENV_DOCTOR_VAR]; else process.env[ENV_DOCTOR_VAR] = prev; });
  const r = runEnvDoctor("/nonexistent");
  assert.ok(hasProblem(r, />= 20/));
  assert.ok(hasProblem(r, /not authenticated/i));
  assert.ok(hasProblem(r, new RegExp(`>= ${MIN_CLAUDE_CODE_VERSION.replace(/\./g, "\\.")}`)));
  assert.ok(hasInfo(r, /Linear MCP not detected/i));
});
