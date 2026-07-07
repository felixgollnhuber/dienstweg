import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_VERSION,
  STATE_DIR,
  configPath,
  defaultConfig,
  loadConfig,
  writeConfig,
  validateConfig,
} from "./config.mjs";
import { runInterview } from "./interview.mjs";
import {
  writeGeneratedFiles,
  writeManifest,
  renderAgentsBlock,
  upsertAgentsBlock,
  ensureLocalRules,
  wireHooks,
} from "./generate.mjs";
import {
  collectFindings,
  buildOnboardingPrompt,
  writeOnboardingPrompt,
} from "./onboarding.mjs";
import { registerRepo } from "./fleet.mjs";

// Ensures .gitignore ignores the throwaway onboarding prompt (it is a
// per-machine artifact, not a committed file).
function ignoreOnboardingPrompt(root) {
  const entry = `${STATE_DIR}/onboarding-prompt.md`;
  const p = join(root, ".gitignore");
  const current = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (current.split(/\r?\n/).includes(entry)) return;
  writeFileSync(p, current + (current && !current.endsWith("\n") ? "\n" : "") + entry + "\n");
}

// The tool-owned directories to commit, per active harness (Claude: .claude;
// Codex: .codex hooks + .agents skills). Shown in the closing "commit these
// files" hint.
function harnessCommitPaths(harnesses) {
  const dirs = [];
  if (harnesses.includes("claude")) dirs.push(".claude/");
  if (harnesses.includes("codex")) dirs.push(".codex/", ".agents/");
  return dirs.join(", ");
}

export async function runInit(root, flags) {
  if (loadConfig(root)) {
    throw new Error(
      `${configPath(root)} already exists - this repo is already initialized. Use \`dienstweg update\`.`,
    );
  }
  if (!existsSync(`${root}/.git`)) {
    console.warn("WARN  no .git directory found - dienstweg assumes it runs at the repo root.");
  }

  const answers = await runInterview(root, flags);

  // Collect collision findings BEFORE writing, so pre-existing files are
  // reported even though init (mode "skip") never overwrites them. Scan only the
  // harnesses being installed.
  const findings = collectFindings(root, answers.harnesses);

  const config = defaultConfig(answers);
  const problems = validateConfig(config);
  if (problems.length) {
    throw new Error(`invalid answers, cannot initialize:\n  - ${problems.join("\n  - ")}`);
  }
  writeConfig(root, config);
  // Record this repo in the user-level fleet registry (best-effort - a
  // non-writable registry must never fail init).
  registerRepo(root);

  const { manifest, skipped } = writeGeneratedFiles(root, null, "skip", config.harnesses);
  writeManifest(root, manifest);
  const hookResult = wireHooks(root, config.harnesses);
  const agentsActions = upsertAgentsBlock(root, renderAgentsBlock(config));
  const localCreated = ensureLocalRules(root);

  // An onboarding audit is warranted whenever the repo already had rules to
  // reconcile - either it looks like an existing project, or init had to skip
  // a colliding file.
  const needsAudit = answers.existing || skipped.length > 0;

  console.log(`dienstweg v${CLI_VERSION} initialized for "${config.project}"`);
  console.log(`  config:   dienstweg.config.json (team ${config.tracker.linearTeam}, prefix ${config.tracker.issuePrefix}, base ${config.git.baseBranch}, harnesses ${config.harnesses.join(" + ")}${config.merge.auto ? "" : ", auto-merge off"})`);
  for (const target of Object.keys(manifest.files)) console.log(`  written:  ${target}`);
  for (const target of skipped) console.log(`  SKIPPED:  ${target} (pre-existing, not overwritten)`);
  for (const a of hookResult.actions) console.log(`  ${a.message}`);
  for (const a of agentsActions) console.log(`  ${a}`);
  if (localCreated) console.log("  written:  dienstweg.local.md (project-owned stub)");

  if (needsAudit) {
    ignoreOnboardingPrompt(root);
    const prompt = buildOnboardingPrompt(config, findings);
    const promptPath = writeOnboardingPrompt(root, prompt);
    const rel = promptPath.replace(root + "/", "");
    console.log(`\nExisting rules detected - a semantic audit by a coding agent is the next step.`);
    console.log(`The onboarding prompt was saved to ${promptPath}.`);
    console.log(`Paste it into Claude Code / Codex (or pipe it: \`claude "$(cat ${rel})"\`):\n`);
    console.log("----------------------------------------------------------------");
    console.log(prompt);
    console.log("----------------------------------------------------------------");
  } else {
    const firstIssueHint = config.harnesses.includes("claude")
      ? "Create your first issue with /create-issue in Claude Code (or the create-issue skill in Codex)."
      : "Create your first issue with the create-issue skill in Codex.";
    console.log("\nFresh repo - no semantic audit needed. Next steps:");
    console.log(`  1. Create the Linear team "${config.tracker.linearTeam}" (key ${config.tracker.issuePrefix}) with labels parallel-safe + single-writer:<area>.`);
    console.log("  2. Run `dienstweg check` to verify the setup.");
    console.log(`  3. ${firstIssueHint}`);
  }
  if (!hookResult.wired) {
    console.error(`\nWARN: the branch-guard hook is NOT wired - fix the hook config and run \`dienstweg update\`.`);
  }
  const commitDirs = harnessCommitPaths(config.harnesses);
  console.log(`\nCommit these files: dienstweg.config.json, dienstweg.local.md, ${commitDirs}, .dienstweg/manifest.json.`);
  return (needsAudit && skipped.length) || !hookResult.wired ? 1 : 0;
}
