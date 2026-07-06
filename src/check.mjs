import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_VERSION,
  CURRENT_SCHEMA_VERSION,
  MARKER_BEGIN,
  MARKER_END,
  CONFIG_FILENAME,
  loadConfig,
  loadManifest,
  validateConfig,
  compareSemver,
} from "./config.mjs";
import {
  sha256,
  generatedFiles,
  orphanedHarnessArtifacts,
  renderAgentsBlock,
  agentsMarkerState,
} from "./generate.mjs";

// The doctor must never crash on the broken states it exists to diagnose: every
// load is guarded and turned into a FAIL line instead of an exception.
export function runCheck(root) {
  const problems = [];
  const infos = [];

  let config;
  try {
    config = loadConfig(root);
  } catch (e) {
    console.error(`FAIL  config: ${e.message}`);
    console.error("check: 1 problem(s) found.");
    return 1;
  }
  if (!config) {
    console.error("check: no dienstweg.config.json found - run `dienstweg init` first.");
    return 1;
  }

  problems.push(...validateConfig(config).map((p) => `config: ${p}`));

  // Which harnesses to verify files + hook wiring for. A pre-v3 config has no
  // harnesses field yet (validateConfig already flags that); fall back to
  // claude-only so the doctor keeps its existing diagnostics and never demands
  // Codex wiring before the migration has run.
  const activeHarnesses = Array.isArray(config.harnesses) && config.harnesses.length
    ? config.harnesses
    : ["claude"];

  // An outdated schema usually explains the missing-field FAILs above; point
  // at the migration instead of leaving the user to add fields by hand.
  if (typeof config.schemaVersion === "number" && config.schemaVersion < CURRENT_SCHEMA_VERSION) {
    infos.push(`config schema v${config.schemaVersion} is behind v${CURRENT_SCHEMA_VERSION} - run \`dienstweg update\` to migrate.`);
  }

  if (config.dienstwegVersion) {
    const cmp = compareSemver(config.dienstwegVersion, CLI_VERSION);
    if (cmp < 0) {
      infos.push(`update available: project is on v${config.dienstwegVersion}, CLI is v${CLI_VERSION} - run \`dienstweg update\`.`);
    } else if (cmp > 0) {
      problems.push(`project was set up with v${config.dienstwegVersion} but this CLI is older (v${CLI_VERSION}) - update the dienstweg repo (git pull).`);
    }
  }

  let manifest;
  try {
    manifest = loadManifest(root);
  } catch (e) {
    problems.push(`state: ${e.message} - run \`dienstweg update\` to regenerate.`);
  }

  if (manifest === null) {
    problems.push("state: .dienstweg/manifest.json missing - run `dienstweg update` to regenerate.");
  } else if (manifest) {
    const files = manifest.files || {};
    for (const [target, hash] of Object.entries(files)) {
      const p = join(root, target);
      if (!existsSync(p)) {
        problems.push(`generated file missing: ${target}`);
      } else if (sha256(readFileSync(p, "utf8")) !== hash) {
        problems.push(`generated file was hand-edited: ${target} - generated files are tool-owned; move customizations to ${CONFIG_FILENAME} or dienstweg.local.md, then run \`dienstweg update --force\`.`);
      }
    }
    for (const spec of generatedFiles(activeHarnesses)) {
      if (!files[spec.target]) {
        problems.push(`unmanaged: ${spec.target} is not tracked by dienstweg (a pre-existing file was skipped during init/update) - adopt the dienstweg version via \`dienstweg update --force\` or move the custom content to dienstweg.local.md.`);
      }
    }
  }

  if (activeHarnesses.includes("claude")) {
    const hookWired = hookIsWired(root);
    if (hookWired === "invalid") {
      problems.push("branch-guard hook is not wired: a .claude settings file is not valid JSON.");
    } else if (!hookWired) {
      problems.push("branch-guard hook is not wired in .claude/settings.json or .claude/settings.local.json.");
    } else if (hasInvalidSettingsFile(root)) {
      // Wired via a valid file, but another settings file is broken - not fatal,
      // but worth surfacing so a corrupt committed settings.json is not masked.
      infos.push("a .claude settings file is not valid JSON (the hook is wired via another file) - fix it to avoid surprises.");
    }
  }

  if (activeHarnesses.includes("codex")) {
    const codexWired = codexHookIsWired(root);
    if (codexWired === "invalid") {
      problems.push("branch-guard hook is not wired for Codex: .codex/hooks.json is not valid JSON.");
    } else if (!codexWired) {
      problems.push("branch-guard hook is not wired for Codex in .codex/hooks.json.");
    }
  }

  // A harness dropped from config.harnesses but still present on disk keeps
  // running the workflow - surface it rather than silently reporting OK.
  for (const orphan of orphanedHarnessArtifacts(root, activeHarnesses)) {
    const bits = [];
    if (orphan.files.length) bits.push(`files (${orphan.files.join(", ")})`);
    if (orphan.wired) bits.push("a wired branch-guard hook");
    problems.push(`harness '${orphan.harness}' is not in config.harnesses but still has ${bits.join(" and ")} on disk - that harness will keep running the workflow. Remove its tree + hook wiring, or add '${orphan.harness}' back to config.harnesses and run \`dienstweg update\`.`);
  }

  const agentsPath = join(root, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    problems.push("AGENTS.md missing.");
  } else {
    const content = readFileSync(agentsPath, "utf8");
    const state = agentsMarkerState(content);
    if (!state.ok) {
      problems.push(`AGENTS.md markers corrupted: ${state.reason} - fix or remove them, then run \`dienstweg update\`.`);
    } else if (!state.present) {
      problems.push("AGENTS.md has no dienstweg marker block - run `dienstweg update`.");
    } else if (validateConfig(config).length === 0) {
      // Compare the on-disk block against a fresh render, catching both
      // hand-edits inside the markers and staleness after a config change.
      const begin = content.indexOf(MARKER_BEGIN);
      const end = content.indexOf(MARKER_END) + MARKER_END.length;
      const onDisk = content.slice(begin, end);
      if (onDisk !== renderAgentsBlock(config)) {
        problems.push("AGENTS.md dienstweg block is hand-edited or stale relative to the config - run `dienstweg update`.");
      }
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

// Returns true (wired), false (not wired), or "invalid" (a settings file is not
// valid JSON). Accepts wiring via settings.json or settings.local.json.
function hookIsWired(root) {
  let sawInvalid = false;
  let wired = false;
  for (const name of ["settings.json", "settings.local.json"]) {
    const p = join(root, ".claude", name);
    if (!existsSync(p)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      sawInvalid = true;
      continue;
    }
    const pre = parsed?.hooks?.PreToolUse;
    if (Array.isArray(pre)) {
      wired ||= pre.some((entry) => (entry?.hooks || []).some((h) => (h?.command || "").includes("branch-guard.mjs")));
    }
  }
  if (wired) return true;
  return sawInvalid ? "invalid" : false;
}

// Codex counterpart of hookIsWired: true (wired), false (not wired), or
// "invalid" (.codex/hooks.json is not valid JSON).
function codexHookIsWired(root) {
  const p = join(root, ".codex", "hooks.json");
  if (!existsSync(p)) return false;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return "invalid";
  }
  const pre = parsed?.hooks?.PreToolUse;
  if (Array.isArray(pre) && pre.some((entry) => (entry?.hooks || []).some((h) => (h?.command || "").includes("branch-guard.mjs")))) {
    return true;
  }
  return false;
}

function hasInvalidSettingsFile(root) {
  for (const name of ["settings.json", "settings.local.json"]) {
    const p = join(root, ".claude", name);
    if (!existsSync(p)) continue;
    try {
      JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return true;
    }
  }
  return false;
}
