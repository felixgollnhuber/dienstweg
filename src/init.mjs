import { existsSync } from "node:fs";
import {
  CLI_VERSION,
  configPath,
  defaultConfig,
  loadConfig,
  writeConfig,
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

export async function runInit(root, flags) {
  if (loadConfig(root)) {
    throw new Error(
      `${configPath(root)} already exists - this repo is already initialized. Use \`npx dienstweg update\`.`,
    );
  }
  if (!existsSync(`${root}/.git`)) {
    console.warn("WARN  no .git directory found - dienstweg assumes it runs at the repo root.");
  }

  const answers = await runInterview(root, flags);

  // Collect collision findings BEFORE writing, so pre-existing files are
  // reported even though init (mode "skip") never overwrites them.
  const findings = answers.existing ? collectFindings(root) : [];

  const config = defaultConfig(answers);
  writeConfig(root, config);

  const { manifest, skipped } = writeGeneratedFiles(root, null, "skip");
  writeManifest(root, manifest);
  const settingsAction = mergeSettings(root);
  const agentsActions = upsertAgentsBlock(root, renderAgentsBlock(config));
  const localCreated = ensureLocalRules(root);

  console.log(`dienstweg v${CLI_VERSION} initialized for "${config.project}"`);
  console.log(`  config:   dienstweg.config.json (team ${config.tracker.linearTeam}, prefix ${config.tracker.issuePrefix}, base ${config.git.baseBranch})`);
  for (const target of Object.keys(manifest.files)) console.log(`  written:  ${target}`);
  for (const target of skipped) console.log(`  SKIPPED:  ${target} (pre-existing, see onboarding prompt)`);
  console.log(`  ${settingsAction}`);
  for (const a of agentsActions) console.log(`  ${a}`);
  if (localCreated) console.log("  written:  dienstweg.local.md (project-owned stub)");

  if (answers.existing) {
    const prompt = buildOnboardingPrompt(config, findings);
    const promptPath = writeOnboardingPrompt(root, prompt);
    console.log(`\nExisting project detected - a semantic audit by a coding agent is the next step.`);
    console.log(`The onboarding prompt was saved to ${promptPath}.`);
    console.log(`Paste it into Claude Code / Codex (or pipe it: \`claude "$(cat ${promptPath.replace(root + "/", "")})"\`):\n`);
    console.log("----------------------------------------------------------------");
    console.log(prompt);
    console.log("----------------------------------------------------------------");
  } else {
    console.log("\nFresh repo - no semantic audit needed. Next steps:");
    console.log(`  1. Create the Linear team "${config.tracker.linearTeam}" (key ${config.tracker.issuePrefix}) with labels parallel-safe + single-writer:<area>.`);
    console.log("  2. Run `npx dienstweg check` to verify the setup.");
    console.log("  3. Create your first issue with /create-issue in Claude Code.");
  }
  return 0;
}
