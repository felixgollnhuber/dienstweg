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
  assert.match(claudeStartTask, /argument-hint: <ISSUE-IDENTIFIER> \[--codex\]/);
  assert.match(claudeStartTask, /`--codex` flag/);
  assert.match(claudeStartTask, /config\.delegation\.implementer/);
  assert.match(claudeStartTask, /The flag wins over the config/);
  assert.match(claudeStartTask, /behaves exactly as before/);
});

test("claude start-task runs the codex readiness preflight before planning", () => {
  assert.match(claudeStartTask, /## Step 1a - Codex preflight \(codex mode only\)/);
  assert.match(
    claudeStartTask,
    /~\/\.claude\/plugins\/cache\/openai-codex\/codex\/\*\/scripts\/codex-companion\.mjs/
  );
  assert.match(claudeStartTask, /setup --json/);
  assert.match(claudeStartTask, /`ready: true`/);
  assert.match(claudeStartTask, /`\/codex:setup`/);
});

test("claude start-task codex-mode /goal condition delegates to codex:codex-rescue", () => {
  assert.match(claudeStartTask, /codex:codex-rescue subagent/);
  assert.match(
    claudeStartTask,
    /the step itself, the plan's touch points, and the loop constraints/
  );
  assert.match(claudeStartTask, /no --no-verify, no force push, no files outside the amended plan's touch points\) - fallback rule/);
  assert.match(claudeStartTask, /exactly one retry via --resume/);
  assert.match(claudeStartTask, /documents the fallback as an issue comment/);
});

test("claude start-task codex-mode review mix is 2x Claude + 1x Codex", () => {
  assert.match(claudeStartTask, /2x Claude \+ 1x Codex/);
  assert.match(claudeStartTask, /adversarial-review --wait --base <config\.git\.baseBranch> --scope branch/);
  assert.match(claudeStartTask, /the Codex reviewer takes the adversarial stance/);
  assert.match(
    claudeStartTask,
    /spec-conformance stance \(issue reference \+ diff checked against ## Plan and ## Acceptance Criteria\) and the maintainer stance go to the Claude reviewers/
  );
  assert.match(claudeStartTask, /`spec-conformance` stance must always land on a Claude reviewer/);
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
  assert.match(out, /2x Claude \+ 1x Codex/);
  assert.match(out, /exactly one retry via `--resume`/);
  assert.doesNotMatch(out, /\{\{\w+\}\}/, "no unresolved tokens");
});
