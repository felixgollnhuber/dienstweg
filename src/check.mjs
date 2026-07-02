import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_VERSION,
  MARKER_BEGIN,
  MARKER_END,
  loadConfig,
  loadManifest,
  validateConfig,
  compareSemver,
} from "./config.mjs";
import { sha256, GENERATED_FILES } from "./generate.mjs";

export function runCheck(root) {
  const problems = [];
  const infos = [];

  const config = loadConfig(root);
  if (!config) {
    console.error("check: no dienstweg.config.json found - run `npx dienstweg init` first.");
    return 1;
  }
  problems.push(...validateConfig(config).map((p) => `config: ${p}`));

  const cmp = compareSemver(config.dienstwegVersion, CLI_VERSION);
  if (cmp < 0) {
    infos.push(`update available: project is on v${config.dienstwegVersion}, CLI is v${CLI_VERSION} - run \`npx dienstweg update\`.`);
  } else if (cmp > 0) {
    problems.push(`project was set up with v${config.dienstwegVersion} but this CLI is older (v${CLI_VERSION}) - update the dienstweg repo (git pull).`);
  }

  const manifest = loadManifest(root);
  if (!manifest) {
    problems.push("state: .dienstweg/manifest.json missing - run `npx dienstweg update` to regenerate.");
  } else {
    for (const [target, hash] of Object.entries(manifest.files)) {
      const p = join(root, target);
      if (!existsSync(p)) {
        problems.push(`generated file missing: ${target}`);
      } else if (sha256(readFileSync(p, "utf8")) !== hash) {
        problems.push(`generated file was hand-edited: ${target} - generated files are tool-owned; move customizations to dienstweg.config.json or dienstweg.local.md, then run \`npx dienstweg update --force\`.`);
      }
    }
    for (const spec of GENERATED_FILES) {
      if (!manifest.files[spec.target]) {
        problems.push(`unmanaged: ${spec.target} is not tracked by dienstweg (a pre-existing file was skipped during init/update) - adopt the dienstweg version via \`npx dienstweg update --force\` or move the custom content to dienstweg.local.md.`);
      }
    }
  }

  const settingsPath = join(root, ".claude", "settings.json");
  let hookWired = false;
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      hookWired = (settings?.hooks?.PreToolUse || []).some((entry) =>
        (entry.hooks || []).some((h) => (h.command || "").includes("branch-guard.mjs")),
      );
    } catch {
      problems.push("settings.json is not valid JSON.");
    }
  }
  if (!hookWired) problems.push("branch-guard hook is not wired in .claude/settings.json.");

  const agentsPath = join(root, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    problems.push("AGENTS.md missing.");
  } else {
    const content = readFileSync(agentsPath, "utf8");
    if (!content.includes(MARKER_BEGIN) || !content.includes(MARKER_END)) {
      problems.push("AGENTS.md has no dienstweg marker block.");
    }
  }

  for (const info of infos) console.log(`INFO  ${info}`);
  if (problems.length === 0) {
    console.log(`check: OK (dienstweg v${config.dienstwegVersion}, project "${config.project}", prefix ${config.tracker.issuePrefix}, base ${config.git.baseBranch})`);
    return 0;
  }
  for (const p of problems) console.error(`FAIL  ${p}`);
  console.error(`check: ${problems.length} problem(s) found.`);
  return 1;
}
