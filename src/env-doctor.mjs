import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { compareSemver } from "./config.mjs";

// The environment doctor: verifies the machine-level prerequisites the dienstweg
// workflow depends on (Node, gh auth, Claude Code, Linear MCP). Unlike computeCheck
// (a pure, PER-REPO filesystem inspection consumed by `check --json` AND by fleet),
// these facts are machine-wide - so they live here and are merged in only at the
// `runCheck` layer, never per-repo inside computeCheck/fleet (which would spawn the
// probes N times and emit N duplicate lines).
//
// The module splits impure probing (probeEnvironment) from pure classification
// (classifyEnvironment) so the severity logic is unit-testable without spawning
// subprocesses - mirroring computeCheck's "gather the diagnosis, don't print it".

export const MIN_NODE_MAJOR = 20;
export const MIN_CLAUDE_CODE_VERSION = "2.1.139";

// Subprocess probes are best-effort; a slow/hung tool must never stall the doctor.
const PROBE_TIMEOUT_MS = 3000;

// Env var that gates the doctor - primarily a TEST SEAM:
//   "off"        -> skip entirely (the shared runCli test helper sets this so the
//                   existing integration tests stay hermetic regardless of the
//                   machine's gh/claude/node state)
//   a JSON value -> parsed as injected fake `readings` (deterministic CLI tests)
//   unset/other  -> run the real probes (production default)
export const ENV_DOCTOR_VAR = "DIENSTWEG_ENV_DOCTOR";

// Pure: maps probe readings to { problems, infos } under the graduated severity
// policy. FAIL (problems) only for a tool that is PRESENT BUT WRONG (Node < 20, gh
// unauthenticated, Claude Code below the /goal minimum); anything missing, offline,
// or undeterminable degrades to INFO. Linear MCP is best-effort -> INFO only.
// Silent on healthy states, matching computeCheck.
export function classifyEnvironment(readings = {}) {
  const problems = [];
  const infos = [];

  // Node: derived from process.versions.node - always present, no subprocess.
  const nodeVersion = readings.node?.version;
  if (nodeVersion) {
    const major = Number(String(nodeVersion).split(".")[0]) || 0;
    if (major < MIN_NODE_MAJOR) {
      problems.push(`node: Node ${nodeVersion} is below the required >= ${MIN_NODE_MAJOR} - upgrade Node (https://nodejs.org).`);
    }
  }

  // gh: missing -> INFO (degrade); installed-but-unauthenticated -> FAIL;
  // undeterminable (timeout / odd exit) -> INFO.
  const gh = readings.gh || {};
  if (gh.installed === false) {
    infos.push("gh (GitHub CLI) not found on PATH - PR creation + merge need it; install from https://cli.github.com.");
  } else if (gh.installed === true) {
    if (gh.authenticated === false) {
      problems.push("gh is installed but not authenticated - run `gh auth login` (PR creation + merge need it).");
    } else if (gh.authenticated !== true) {
      infos.push("gh auth status could not be determined - verify with `gh auth status`.");
    }
  }

  // claudeCode: missing -> INFO; present-but-old -> FAIL (the /goal loop needs
  // >= MIN); present-but-unparseable version -> INFO.
  const cc = readings.claudeCode || {};
  if (cc.installed === false) {
    infos.push(`Claude Code CLI not found on PATH - the /goal loop needs >= ${MIN_CLAUDE_CODE_VERSION}.`);
  } else if (cc.installed === true) {
    if (typeof cc.version === "string" && cc.version) {
      if (compareSemver(cc.version, MIN_CLAUDE_CODE_VERSION) < 0) {
        problems.push(`Claude Code v${cc.version} is below the required >= ${MIN_CLAUDE_CODE_VERSION} - the /goal loop needs it; upgrade Claude Code.`);
      }
    } else {
      infos.push(`Claude Code is installed but its version could not be determined - ensure it is >= ${MIN_CLAUDE_CODE_VERSION}.`);
    }
  }

  // Linear MCP: best effort - INFO only. Not detected -> a nudge; detected (or
  // undeterminable) -> silent, so we never nag a correctly configured setup.
  const linear = readings.linearMcp || {};
  if (linear.visible === false) {
    infos.push("Linear MCP not detected in .mcp.json, .claude settings, or ~/.claude.json (best effort) - issue operations need it; ensure the Linear MCP server is configured.");
  }

  return { problems, infos };
}

// Impure, best-effort, NEVER throws. Gathers raw readings for classifyEnvironment.
// A JSON value in ENV_DOCTOR_VAR is treated as injected fake readings so CLI tests
// can drive deterministic output without a real gh/claude on the machine.
export function probeEnvironment(root) {
  const injected = injectedReadings();
  if (injected) return injected;
  return {
    node: { version: process.versions.node },
    gh: safe(probeGh, { installed: false, authenticated: null }),
    claudeCode: safe(probeClaudeCode, { installed: false, version: null }),
    linearMcp: safe(() => detectLinearMcp(root), { visible: false, source: null }),
  };
}

// Dispatch used by runCheck. Honors the ENV_DOCTOR_VAR test seam: "off" skips the
// doctor entirely (no findings); otherwise probe + classify.
export function runEnvDoctor(root) {
  if (process.env[ENV_DOCTOR_VAR] === "off") return { problems: [], infos: [] };
  return classifyEnvironment(probeEnvironment(root));
}

// Best-effort scan for a configured Linear MCP server. We cannot know from a CLI
// subprocess whether the *agent* actually sees the server, so we look for evidence
// in the known MCP config files - repo-local (.mcp.json, .claude/settings*.json)
// and the user-global ~/.claude.json - matching /linear/i in an mcpServers entry
// (or a Claude Code enabledMcpjsonServers list). Every read is guarded; a missing
// or corrupt file simply does not count.
export function detectLinearMcp(root) {
  const candidates = [
    join(root, ".mcp.json"),
    join(root, ".claude", "settings.json"),
    join(root, ".claude", "settings.local.json"),
    join(homedir(), ".claude.json"),
  ];
  for (const p of candidates) {
    if (configMentionsLinear(readJson(p))) return { visible: true, source: p };
  }
  return { visible: false, source: null };
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Shape-aware, not a blind deep walk: ~/.claude.json can be large (it stores
// per-project history), so we only look where mcpServers actually lives - at the
// top level (.mcp.json, ~/.claude.json global) and under projects[<path>].
function configMentionsLinear(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const maps = [];
  const add = (m) => { if (m && typeof m === "object") maps.push(m); };
  add(parsed.mcpServers);
  if (parsed.projects && typeof parsed.projects === "object") {
    for (const proj of Object.values(parsed.projects)) {
      if (proj && typeof proj === "object") add(proj.mcpServers);
    }
  }
  for (const servers of maps) {
    for (const [name, def] of Object.entries(servers)) {
      if (/linear/i.test(name)) return true;
      if (/linear/i.test(JSON.stringify(def ?? ""))) return true;
    }
  }
  // Claude Code settings enable servers by name in this array.
  const enabled = parsed.enabledMcpjsonServers;
  if (Array.isArray(enabled) && enabled.some((s) => /linear/i.test(String(s)))) return true;
  return false;
}

function injectedReadings() {
  const raw = process.env[ENV_DOCTOR_VAR];
  if (!raw || raw === "off" || raw === "on") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // not JSON -> fall through to the real probes
  }
  return null;
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function probeGh() {
  const r = spawnSync("gh", ["auth", "status"], { timeout: PROBE_TIMEOUT_MS, encoding: "utf8" });
  if (r.error) {
    // ENOENT -> not installed; any other spawn error -> installed but undeterminable.
    if (r.error.code === "ENOENT") return { installed: false, authenticated: null };
    return { installed: true, authenticated: null };
  }
  if (r.status === 0) return { installed: true, authenticated: true };
  if (typeof r.status === "number") return { installed: true, authenticated: false };
  // status null (e.g. killed by the timeout) -> undeterminable.
  return { installed: true, authenticated: null };
}

function probeClaudeCode() {
  const r = spawnSync("claude", ["--version"], { timeout: PROBE_TIMEOUT_MS, encoding: "utf8" });
  if (r.error) {
    if (r.error.code === "ENOENT") return { installed: false, version: null };
    return { installed: true, version: null };
  }
  const out = `${r.stdout || ""}`;
  const m = out.match(/\d+\.\d+\.\d+/);
  return { installed: true, version: m ? m[0] : null };
}
