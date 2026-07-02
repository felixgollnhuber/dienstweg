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
  mergeSettings,
} from "./generate.mjs";
import {
  collectFindings,
  buildOnboardingPrompt,
  writeOnboardingPrompt,
} from "./onboarding.mjs";

// Ensures .gitignore ignores the throwaway onboarding prompt (it is a
// per-machine artifact, not a committed file).
function ignoreOnboardingPrompt(root) {
  const entry = `${STATE_DIR}/onboarding-prompt.md`;
  const p = join(root, ".gitignore");
  const current = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (current.split(/\r?\n/).includes(entry)) return;
  writeFileSync(p, current + (current && !current.endsWith("\n") ? "\n" : "") + entry + "\n");
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
  // reported even though init (mode "skip") never overwrites them.
  const findings = collectFindings(root);

  const config = defaultConfig(answers);
  const problems = validateConfig(config);
  if (problems.length) {
    throw new Error(`invalid answers, cannot initialize:\n  - ${problems.join("\n  - ")}`);
  }
  writeConfig(root, config);

  const { manifest, skipped } = writeGeneratedFiles(root, null, "skip");
  writeManifest(root, manifest);
  const settingsAction = mergeSettings(root);
  const agentsActions = upsertAgentsBlock(root, renderAgentsBlock(config));
  const localCreated = ensureLocalRules(root);

  // An onboarding audit is warranted whenever the repo already had rules to
  // reconcile - either it looks like an existing project, or init had to skip
  // a colliding file.
  const needsAudit = answers.existing || skipped.length > 0;

  console.log(`dienstweg v${CLI_VERSION} initialized for "${config.project}"`);
  console.log(`  config:   dienstweg.config.json (team ${config.tracker.linearTeam}, prefix ${config.tracker.issuePrefix}, base ${config.git.baseBranch})`);
  for (const target of Object.keys(manifest.files)) console.log(`  written:  ${target}`);
  for (const target of skipped) console.log(`  SKIPPED:  ${target} (pre-existing, not overwritten)`);
  console.log(`  ${settingsAction.message}`);
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
    console.log("\nFresh repo - no semantic audit needed. Next steps:");
    console.log(`  1. Create the Linear team "${config.tracker.linearTeam}" (key ${config.tracker.issuePrefix}) with labels parallel-safe + single-writer:<area>.`);
    console.log("  2. Run `dienstweg check` to verify the setup.");
    console.log("  3. Create your first issue with /create-issue in Claude Code.");
  }
  if (!settingsAction.wired) {
    console.error(`\nWARN: the branch-guard hook is NOT wired - fix .claude/settings.json and run \`dienstweg update\`.`);
  }
  console.log("\nCommit these files: dienstweg.config.json, dienstweg.local.md, .claude/, .dienstweg/manifest.json.");
  return (needsAudit && skipped.length) || !settingsAction.wired ? 1 : 0;
}
