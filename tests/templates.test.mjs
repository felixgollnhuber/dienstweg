import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig } from "../src/config.mjs";
import { renderAgentsBlock } from "../src/generate.mjs";
import { ROOT } from "./helpers.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const claudeStartTask = read("templates/claude/commands/start-task.md");
const codexStartTask = read("templates/codex/skills/start-task/SKILL.md");

const cfg = defaultConfig({
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
});

test("claude start-task documents the --codex flag and the config default", () => {
  assert.match(claudeStartTask, /argument-hint: <ISSUE-IDENTIFIER> \[--codex\|--no-codex\]/);
  assert.match(claudeStartTask, /`--codex` flag/);
  assert.match(claudeStartTask, /`--no-codex` forces it OFF/);
  assert.match(claudeStartTask, /config\.delegation\.implementer/);
  assert.match(claudeStartTask, /behaves exactly as before/);
});

test("claude start-task runs the codex readiness preflight before the claim", () => {
  assert.match(claudeStartTask, /## Step 0a - Codex preflight \(codex mode only\)/);
  assert.ok(
    claudeStartTask.indexOf("## Step 0a - Codex preflight") <
      claudeStartTask.indexOf("## Step 1 - Load the issue"),
    "preflight comes before the issue claim"
  );
  assert.match(
    claudeStartTask,
    /~\/\.claude\/plugins\/cache\/openai-codex\/codex\/\*\/scripts\/codex-companion\.mjs/
  );
  assert.match(claudeStartTask, /highest semver/);
  assert.match(claudeStartTask, /setup --json/);
  assert.match(claudeStartTask, /`ready: true`/);
  assert.match(claudeStartTask, /`\/codex:setup`/);
});

test("claude start-task codex-mode /goal condition delegates to codex:codex-rescue", () => {
  assert.match(claudeStartTask, /codex:codex-rescue subagent/);
  assert.match(claudeStartTask, /the plan's touch points/);
  assert.match(
    claudeStartTask,
    /no --no-verify, no hook bypass, no push to protected branches, no force push, <config\.extraConstraints - omit if empty>, no files outside the amended plan's touch points/
  );
  assert.match(claudeStartTask, /exactly one retry via --resume/);
  assert.match(claudeStartTask, /documents the fallback as an issue comment/);
});

test("claude start-task codex-mode review mix swaps one reviewer for Codex", () => {
  assert.match(claudeStartTask, /<ensembleSize minus 1>x Claude \+ 1x Codex/);
  assert.match(claudeStartTask, /2x Claude \+ 1x Codex/);
  assert.match(
    claudeStartTask,
    /adversarial-review --wait --base <config\.git\.baseBranch> --scope branch/
  );
  assert.match(claudeStartTask, /the Codex reviewer takes the adversarial stance/);
  assert.match(claudeStartTask, /first stance that is not `spec-conformance`/);
  assert.match(claudeStartTask, /`spec-conformance` stance must always land on a Claude reviewer/);
});

test("default /goal condition block stays codex-free", () => {
  const fenced = claudeStartTask.match(/```\n(\/goal [^\n]+)\n```/);
  assert.ok(fenced, "fenced /goal condition block found");
  assert.doesNotMatch(fenced[1], /codex/i, "default condition must not mention codex");
});

test("codex-harness start-task skill has no delegation mode", () => {
  assert.doesNotMatch(codexStartTask, /--codex/);
  assert.doesNotMatch(codexStartTask, /delegation\.implementer/);
  assert.doesNotMatch(codexStartTask, /codex-rescue/);
});

test("agents block documents the delegation mode and still renders token-free", () => {
  const out = renderAgentsBlock(cfg);
  assert.match(out, /\*\*Codex delegation mode \(Claude Code harness only\):\*\*/);
  assert.match(out, /\/start-task DEM-XXX --codex/);
  assert.match(out, /delegation\.implementer: "codex"/);
  assert.match(out, /keeps its size \(3 reviewers\)/, "ensembleSize token resolved");
  assert.match(out, /2x Claude \+ 1x Codex/);
  assert.match(out, /exactly one retry via `--resume`/);
  assert.doesNotMatch(out, /\{\{\w+\}\}/, "no unresolved tokens");
});
