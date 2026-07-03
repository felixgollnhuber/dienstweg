import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";

function derivePrefix(name) {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (letters.slice(0, 3) || "PRJ").padEnd(3, "X");
}

function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function detectExistingProject(root) {
  const signals = [];
  for (const f of ["CLAUDE.md", "AGENTS.md", ".claude", "package.json", "src"]) {
    if (existsSync(join(root, f))) signals.push(f);
  }
  return signals;
}

function parseList(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Collects all init answers. Flags always win; in --yes mode the remaining
// answers fall back to defaults; otherwise the user is asked interactively.
export async function runInterview(root, flags) {
  const signals = detectExistingProject(root);
  const defaults = {
    existing: signals.length > 0,
    project: basename(root),
    language: "en",
    baseBranch: "main",
    buildGates: "npm run build && npm test",
    autoMerge: true,
    defaultProject: "",
    highRisk: [],
    singleWriter: [],
  };

  const rl = flags.yes ? null : createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question, fallback) => {
    if (rl === null) return fallback;
    const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
    return answer || fallback;
  };

  try {
    let existing;
    if (flags.existing !== undefined) {
      existing = flags.existing;
    } else if (flags.yes) {
      existing = defaults.existing;
    } else {
      const detected = signals.length
        ? `existing project detected (${signals.join(", ")})`
        : "looks like a fresh repo";
      const answer = await ask(
        `Is this an existing project or a fresh repo? ${detected} - answer "existing" or "new"`,
        defaults.existing ? "existing" : "new",
      );
      existing = answer.toLowerCase().startsWith("e");
    }

    const project = flags.name ?? (await ask("Project name", defaults.project));
    const language = flags.language ?? (await ask("Conversation language (en/de/...)", defaults.language));
    const issuePrefix = (flags.prefix ?? (await ask("Linear issue prefix (team key)", derivePrefix(project)))).toUpperCase();
    const linearTeam = flags.team ?? (await ask("Linear team name", capitalize(project)));
    const defaultProject = flags.project ?? (await ask("Default Linear project (empty = team backlog)", defaults.defaultProject));
    const baseBranch = flags.base ?? (await ask("Base branch for PRs", defaults.baseBranch));
    const buildGates = flags.gates ?? (await ask("Build/test gate command(s)", defaults.buildGates));
    const autoMerge = flags.autoMerge !== undefined
      ? flags.autoMerge
      : !(await ask("Auto-merge PRs when all gates are green? (yes/no)", defaults.autoMerge ? "yes" : "no"))
          .toLowerCase()
          .startsWith("n");
    const highRisk = flags.highRisk !== undefined
      ? parseList(flags.highRisk)
      : parseList(await ask("High-risk areas (comma-separated, empty = none)", ""));
    const singleWriter = flags.singleWriter !== undefined
      ? parseList(flags.singleWriter)
      : parseList(await ask("Single-writer areas (comma-separated, empty = none)", ""));

    return {
      existing,
      signals,
      project,
      language,
      issuePrefix,
      linearTeam,
      defaultProject,
      baseBranch,
      buildGates,
      autoMerge,
      highRisk,
      singleWriter,
    };
  } finally {
    rl?.close();
  }
}
