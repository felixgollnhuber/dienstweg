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

const NO_CONFIG_MSG = "no dienstweg.config.json found - run `dienstweg init` first.";

// Pure inspection: gathers every diagnostic without printing, so the same result
// feeds the human formatter, `check --json`, and the fleet aggregation. Never
// throws on the broken states it exists to diagnose - each load is guarded and
// turned into a problem string instead.
//
// Returns { ok, problems, infos, conflicts, config, dienstwegVersion, cliVersion,
// noConfig? }. `conflicts` is the list of generated-file conflict targets
// (hand-edited / unmanaged / missing generated file); its length is the count
// surfaced by `fleet status`.
export function computeCheck(root) {
  const problems = [];
  const infos = [];
  const conflicts = [];
  const base = { infos, conflicts, cliVersion: CLI_VERSION, noConfig: false };

  let config;
  try {
    config = loadConfig(root);
  } catch (e) {
    // Invalid JSON: mirror the original single-FAIL output via the generic
    // printer. This reproduces the original byte-for-byte ONLY because `infos`
    // is still empty here - do not push an info before this guard, or the
    // invalid-JSON path would start emitting INFO lines it never printed.
    return { ...base, ok: false, problems: [`config: ${e.message}`], config: null, dienstwegVersion: null };
  }
  if (!config) {
    return { ...base, ok: false, noConfig: true, problems: [NO_CONFIG_MSG], config: null, dienstwegVersion: null };
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
      problems.push(`project was set up with v${config.dienstwegVersion} but this CLI is older (v${CLI_VERSION}) - upgrade the dienstweg CLI (npm i -g dienstweg@latest).`);
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
        conflicts.push(target);
        problems.push(`generated file missing: ${target}`);
      } else if (sha256(readFileSync(p, "utf8")) !== hash) {
        conflicts.push(target);
        problems.push(`generated file was hand-edited: ${target} - generated files are tool-owned; move customizations to ${CONFIG_FILENAME} or dienstweg.local.md, then run \`dienstweg update --force\`.`);
      }
    }
    for (const spec of generatedFiles(activeHarnesses)) {
      if (!files[spec.target]) {
        conflicts.push(spec.target);
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

  return {
    ...base,
    ok: problems.length === 0,
    problems,
    config,
    dienstwegVersion: config.dienstwegVersion ?? null,
  };
}

// Machine-readable shape for `check --json` (and any external aggregator). The
// human `check` output is the stable contract for people; this is the stable
// contract for tools - both derive from computeCheck. Takes an already-computed
// result so callers never scan twice.
export function checkJson(root, result) {
  return {
    root,
    ok: result.ok,
    dienstwegVersion: result.dienstwegVersion,
    cliVersion: result.cliVersion,
    conflicts: result.conflicts.length,
    problems: result.problems,
    infos: result.infos,
  };
}

// The doctor: computes the diagnosis, then prints it. `opts.json` swaps the
// human report for the machine-readable one; the exit code is identical.
export function runCheck(root, opts = {}) {
  const result = computeCheck(root);

  if (opts.json) {
    console.log(JSON.stringify(checkJson(root, result), null, 2));
    return result.ok ? 0 : 1;
  }

  if (result.noConfig) {
    console.error(`check: ${NO_CONFIG_MSG}`);
    return 1;
  }

  for (const info of result.infos) console.log(`INFO  ${info}`);
  if (result.ok) {
    const c = result.config;
    console.log(`check: OK (dienstweg v${c.dienstwegVersion}, project "${c.project}", prefix ${c.tracker.issuePrefix}, base ${c.git.baseBranch})`);
    return 0;
  }
  for (const p of result.problems) console.error(`FAIL  ${p}`);
  console.error(`check: ${result.problems.length} problem(s) found.`);
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
