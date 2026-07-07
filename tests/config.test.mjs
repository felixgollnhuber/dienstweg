import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfig,
  defaultConfig,
  CURRENT_SCHEMA_VERSION,
  KNOWN_HARNESSES,
  DEFAULT_STANCES,
} from "../src/config.mjs";
import { migrations } from "../migrations/index.mjs";
import { parseHarnesses } from "../src/interview.mjs";

const baseAnswers = {
  project: "demo",
  language: "en",
  harnesses: ["claude", "codex"],
  linearTeam: "Demo",
  issuePrefix: "DEM",
  defaultProject: "",
  baseBranch: "main",
  buildGates: "npm test",
  autoMerge: true,
  highRisk: [],
  singleWriter: [],
};

test("schema is at v4", () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 4);
});

test("KNOWN_HARNESSES is claude + codex", () => {
  assert.deepEqual(KNOWN_HARNESSES, ["claude", "codex"]);
});

test("defaultConfig carries harnesses and current schema", () => {
  const c = defaultConfig(baseAnswers);
  assert.deepEqual(c.harnesses, ["claude", "codex"]);
  assert.equal(c.schemaVersion, 4);
  assert.equal(c.merge.auto, true);
});

test("defaultConfig carries the default reviewer stances", () => {
  const c = defaultConfig(baseAnswers);
  assert.deepEqual(c.review.stances, ["adversarial", "spec-conformance", "maintainer"]);
  assert.deepEqual(c.review.stances, DEFAULT_STANCES);
  // A fresh copy, not a shared reference to the module-level constant.
  assert.notEqual(c.review.stances, DEFAULT_STANCES);
});

test("validateConfig accepts the default stances", () => {
  assert.deepEqual(validateConfig(defaultConfig(baseAnswers)), []);
});

test("validateConfig rejects missing / empty / non-array / non-string stances", () => {
  const missing = defaultConfig(baseAnswers);
  delete missing.review.stances;
  assert.ok(validateConfig(missing).some((p) => p.includes("review.stances")));

  const empty = defaultConfig(baseAnswers);
  empty.review.stances = [];
  assert.ok(validateConfig(empty).some((p) => p.includes("review.stances")));

  const notArray = defaultConfig(baseAnswers);
  notArray.review.stances = "adversarial";
  assert.ok(validateConfig(notArray).some((p) => p.includes("review.stances")));

  const blankElement = defaultConfig(baseAnswers);
  blankElement.review.stances = ["adversarial", "   "];
  assert.ok(validateConfig(blankElement).some((p) => p.includes("review.stances")));

  const nonString = defaultConfig(baseAnswers);
  nonString.review.stances = ["adversarial", 3];
  assert.ok(validateConfig(nonString).some((p) => p.includes("review.stances")));
});

test("validateConfig accepts custom non-empty stances", () => {
  const c = defaultConfig(baseAnswers);
  c.review.stances = ["security", "performance"];
  assert.deepEqual(validateConfig(c), []);
});

test("validateConfig accepts valid harness sets", () => {
  for (const h of [["claude"], ["codex"], ["claude", "codex"]]) {
    const c = defaultConfig({ ...baseAnswers, harnesses: h });
    assert.deepEqual(validateConfig(c), [], `harnesses ${JSON.stringify(h)} should be valid`);
  }
});

test("validateConfig rejects empty / non-array / unknown harnesses", () => {
  const empty = defaultConfig({ ...baseAnswers, harnesses: [] });
  assert.ok(validateConfig(empty).some((p) => p.includes("harnesses")));

  const notArray = defaultConfig(baseAnswers);
  notArray.harnesses = "claude";
  assert.ok(validateConfig(notArray).some((p) => p.includes("harnesses")));

  const unknown = defaultConfig({ ...baseAnswers, harnesses: ["claude", "cursor"] });
  assert.ok(validateConfig(unknown).some((p) => p.includes("cursor")));
});

test("migration to v2 adds merge.auto (default true)", () => {
  const m2 = migrations.find((m) => m.toSchemaVersion === 2);
  const c = {};
  m2.migrate(c);
  assert.equal(c.merge.auto, true);
});

test("migration to v3 adds harnesses (both by default)", () => {
  const m3 = migrations.find((m) => m.toSchemaVersion === 3);
  const c = {};
  m3.migrate(c);
  assert.deepEqual(c.harnesses, ["claude", "codex"]);
});

test("migration to v3 preserves an existing harnesses field", () => {
  const m3 = migrations.find((m) => m.toSchemaVersion === 3);
  const c = { harnesses: ["claude"] };
  m3.migrate(c);
  assert.deepEqual(c.harnesses, ["claude"]);
});

test("migration to v4 adds review.stances (defaults)", () => {
  const m4 = migrations.find((m) => m.toSchemaVersion === 4);
  const c = {};
  m4.migrate(c);
  assert.deepEqual(c.review.stances, ["adversarial", "spec-conformance", "maintainer"]);
});

test("migration to v4 preserves existing stances and other review fields", () => {
  const m4 = migrations.find((m) => m.toSchemaVersion === 4);
  const c = { review: { ensembleSize: 5, stances: ["security"] } };
  m4.migrate(c);
  assert.deepEqual(c.review.stances, ["security"]);
  assert.equal(c.review.ensembleSize, 5);
});

test("applying all migrations to a v1-era config reaches the current schema shape", () => {
  const c = { schemaVersion: 1 };
  for (const m of migrations.sort((a, b) => a.toSchemaVersion - b.toSchemaVersion)) {
    m.migrate(c);
  }
  assert.equal(c.merge.auto, true);
  assert.deepEqual(c.harnesses, ["claude", "codex"]);
  assert.deepEqual(c.review.stances, ["adversarial", "spec-conformance", "maintainer"]);
});

test("parseHarnesses maps both/claude/codex/lists", () => {
  assert.deepEqual(parseHarnesses("both"), ["claude", "codex"]);
  assert.deepEqual(parseHarnesses(""), ["claude", "codex"]);
  assert.deepEqual(parseHarnesses("claude"), ["claude"]);
  assert.deepEqual(parseHarnesses("codex"), ["codex"]);
  assert.deepEqual(parseHarnesses("codex, claude"), ["codex", "claude"]);
  assert.deepEqual(parseHarnesses("BOTH"), ["claude", "codex"]);
});
