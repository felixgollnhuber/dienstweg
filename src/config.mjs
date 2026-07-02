import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_FILENAME = "dienstweg.config.json";
export const STATE_DIR = ".dienstweg";
export const MANIFEST_FILENAME = "manifest.json";
export const CURRENT_SCHEMA_VERSION = 1;
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
  return JSON.parse(readFileSync(p, "utf8"));
}

export function writeConfig(root, config) {
  writeFileSync(configPath(root), JSON.stringify(config, null, 2) + "\n");
}

export function loadManifest(root) {
  const p = manifestPath(root);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

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
];

export function validateConfig(config) {
  const problems = [];
  for (const path of REQUIRED_PATHS) {
    let node = config;
    for (const key of path) {
      node = node?.[key];
    }
    if (node === undefined || node === null) {
      if (!(path[0] === "tracker" && path[1] === "defaultProject")) {
        problems.push(`missing field: ${path.join(".")}`);
      }
    }
  }
  if (config.schemaVersion > CURRENT_SCHEMA_VERSION) {
    problems.push(
      `config schemaVersion ${config.schemaVersion} is newer than this CLI supports (${CURRENT_SCHEMA_VERSION}). Update the dienstweg repo (git pull).`,
    );
  }
  return problems;
}

export function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
