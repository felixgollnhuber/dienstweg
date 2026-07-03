import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_FILENAME = "dienstweg.config.json";
export const STATE_DIR = ".dienstweg";
export const MANIFEST_FILENAME = "manifest.json";
export const CURRENT_SCHEMA_VERSION = 2;
export const MARKER_BEGIN = "<!-- dienstweg:begin -->";
export const MARKER_END = "<!-- dienstweg:end -->";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
export const CLI_VERSION = JSON.parse(readFileSync(pkgPath, "utf8")).version;

export function configPath(root) {
  return join(root, CONFIG_FILENAME);
}

export function manifestPath(root) {
  return join(root, STATE_DIR, MANIFEST_FILENAME);
}

export function loadConfig(root) {
  const p = configPath(root);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`${CONFIG_FILENAME} is not valid JSON: ${e.message}`);
  }
}

export function writeConfig(root, config) {
  writeFileSync(configPath(root), JSON.stringify(config, null, 2) + "\n");
}

export function loadManifest(root) {
  const p = manifestPath(root);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`${STATE_DIR}/${MANIFEST_FILENAME} is not valid JSON: ${e.message}`);
  }
}

export const ISSUE_PREFIX_RE = /^[A-Z][A-Z0-9]*$/;

export function defaultConfig(answers) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dienstwegVersion: CLI_VERSION,
    project: answers.project,
    language: answers.language,
    tracker: {
      linearTeam: answers.linearTeam,
      issuePrefix: answers.issuePrefix,
      defaultProject: answers.defaultProject || null,
    },
    git: {
      baseBranch: answers.baseBranch,
      protectedBranches: [answers.baseBranch],
    },
    gates: {
      build: answers.buildGates,
    },
    areas: {
      highRisk: answers.highRisk,
      singleWriter: answers.singleWriter,
    },
    review: {
      ensembleSize: 3,
      maxRounds: 3,
      subagentType: "ensemble-reviewer",
    },
    merge: {
      auto: answers.autoMerge,
    },
    extraDoD: [],
    extraConstraints: [],
  };
}

const REQUIRED_PATHS = [
  ["schemaVersion"],
  ["dienstwegVersion"],
  ["project"],
  ["language"],
  ["tracker", "linearTeam"],
  ["tracker", "issuePrefix"],
  ["git", "baseBranch"],
  ["git", "protectedBranches"],
  ["gates", "build"],
  ["areas", "highRisk"],
  ["areas", "singleWriter"],
  ["review", "ensembleSize"],
  ["review", "maxRounds"],
  ["review", "subagentType"],
  ["merge", "auto"],
];

export function validateConfig(config) {
  const problems = [];
  for (const path of REQUIRED_PATHS) {
    let node = config;
    for (const key of path) {
      node = node?.[key];
    }
    if (node === undefined || node === null || node === "") {
      problems.push(`missing field: ${path.join(".")}`);
    }
  }
  const prefix = config?.tracker?.issuePrefix;
  if (prefix && !ISSUE_PREFIX_RE.test(prefix)) {
    problems.push(`tracker.issuePrefix "${prefix}" is invalid - must match ${ISSUE_PREFIX_RE} (a Linear team key, e.g. FAC).`);
  }
  const autoMerge = config?.merge?.auto;
  if (autoMerge !== undefined && autoMerge !== null && typeof autoMerge !== "boolean") {
    problems.push(`merge.auto must be a boolean (true/false), got ${JSON.stringify(autoMerge)} - a string like "false" would be read as enabled.`);
  }
  if (typeof config?.schemaVersion === "number" && config.schemaVersion > CURRENT_SCHEMA_VERSION) {
    problems.push(
      `config schemaVersion ${config.schemaVersion} is newer than this CLI supports (${CURRENT_SCHEMA_VERSION}). Update the dienstweg repo (git pull).`,
    );
  }
  return problems;
}

// Compares plain semver cores (x.y.z), ignoring any -prerelease/+build suffix.
// Missing/empty input is treated as 0.0.0 so callers never crash on a config
// that is missing its version stamp.
export function compareSemver(a, b) {
  const core = (v) => String(v ?? "0.0.0").split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const pa = core(a);
  const pb = core(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
