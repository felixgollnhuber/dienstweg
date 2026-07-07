import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { CONFIG_FILENAME } from "./config.mjs";
import { computeCheck } from "./check.mjs";
import { runUpdate } from "./update.mjs";

const FLEET_VERSION = 1;

// The user-level registry of repos that use dienstweg. Honors XDG_CONFIG_HOME
// (falling back to ~/.config) so tests can isolate it to a temp dir and it
// respects a customized config home. Resolved per call, never cached, so an
// env change between calls (tests, subprocesses) takes effect.
export function fleetPath() {
  const configHome = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()
    ? process.env.XDG_CONFIG_HOME
    : join(homedir(), ".config");
  return join(configHome, "dienstweg", "fleet.json");
}

// Reads the registry without pruning. Tolerates a missing or corrupt file the
// same way the manifest loader does - a broken registry must never dead-end the
// commands, so it degrades to an empty fleet. Always returns a normalized
// { version, repos: string[] } with a de-duplicated, string-only repo list.
export function loadFleet() {
  const p = fleetPath();
  if (!existsSync(p)) return { version: FLEET_VERSION, repos: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { version: FLEET_VERSION, repos: [] };
  }
  const repos = Array.isArray(parsed?.repos)
    ? [...new Set(parsed.repos.filter((r) => typeof r === "string" && r.trim() !== ""))]
    : [];
  return { version: FLEET_VERSION, repos };
}

export function writeFleet(repos) {
  const p = fleetPath();
  mkdirSync(dirname(p), { recursive: true });
  const sorted = [...new Set(repos)].sort();
  writeFileSync(p, JSON.stringify({ version: FLEET_VERSION, repos: sorted }, null, 2) + "\n");
  return sorted;
}

// A registry entry is live only while the directory still exists AND still
// carries a dienstweg config - a repo whose config was removed is no longer a
// dienstweg repo and is treated as dead.
export function isLiveRepo(repoPath) {
  return existsSync(repoPath) && existsSync(join(repoPath, CONFIG_FILENAME));
}

// Reads the registry and prunes dead paths on read, persisting the pruned set
// only when something actually changed (self-healing without needless writes).
// Returns the live repo paths.
export function readFleet() {
  const { repos } = loadFleet();
  const live = repos.filter(isLiveRepo);
  if (live.length !== repos.length) writeFleet(live);
  return live;
}

// Records a repo in the registry. Best-effort: init/update call this after a
// successful setup and must never fail because the user-level registry is not
// writable, so every error is swallowed. Returns true if the repo is now
// registered (added or already present), false if the write failed.
export function registerRepo(root) {
  const abs = resolve(root);
  try {
    const { repos } = loadFleet();
    if (repos.includes(abs)) return true;
    writeFleet([...repos, abs]);
    return true;
  } catch {
    return false;
  }
}

function pluralConflicts(n) {
  return `${n} conflict${n === 1 ? "" : "s"}`;
}

// `fleet status`: one line per repo - stamped dienstwegVersion vs CLI version,
// check result (OK/FAIL), conflict count. Purely a report, so it always exits 0.
function fleetStatus(repos) {
  if (repos.length === 0) {
    console.log("fleet: no repos registered - run `dienstweg init` or `dienstweg update` in a repo.");
    return 0;
  }
  const rows = repos.map((repo) => {
    const r = computeCheck(repo);
    return {
      repo,
      version: `v${r.dienstwegVersion ?? "?"} -> v${r.cliVersion}`,
      result: r.ok ? "OK" : "FAIL",
      conflicts: pluralConflicts(r.conflicts.length),
    };
  });
  const repoW = Math.max(...rows.map((row) => row.repo.length));
  const verW = Math.max(...rows.map((row) => row.version.length));
  for (const row of rows) {
    console.log(`${row.repo.padEnd(repoW)}  ${row.version.padEnd(verW)}  ${row.result.padEnd(4)}  ${row.conflicts}`);
  }
  return 0;
}

// `fleet check`: run the doctor across every registered repo and aggregate.
// Non-zero exit if any repo fails; the failing repos' problems are listed so the
// aggregate output is actionable, not just a tally.
function fleetCheck(repos) {
  if (repos.length === 0) {
    console.log("fleet: no repos registered - run `dienstweg init` or `dienstweg update` in a repo.");
    return 0;
  }
  let failed = 0;
  for (const repo of repos) {
    const r = computeCheck(repo);
    if (r.ok) {
      console.log(`OK    ${repo}`);
    } else {
      failed++;
      console.log(`FAIL  ${repo} (${r.problems.length} problem(s))`);
      for (const p of r.problems) console.log(`        - ${p}`);
    }
  }
  console.log(`\nfleet check: ${repos.length} repo(s), ${failed} failing.`);
  return failed > 0 ? 1 : 0;
}

// `fleet update`: run `update` across every registered repo. Each repo's own
// update output is printed under a header; a repo that throws or exits non-zero
// counts as a failure. Non-zero exit if any repo fails.
function fleetUpdate(repos) {
  if (repos.length === 0) {
    console.log("fleet: no repos registered - run `dienstweg init` or `dienstweg update` in a repo.");
    return 0;
  }
  let failed = 0;
  for (const repo of repos) {
    console.log(`== ${repo} ==`);
    try {
      const code = runUpdate(repo, {});
      if (code !== 0) failed++;
    } catch (e) {
      failed++;
      console.error(`  ERROR: ${e.message}`);
    }
  }
  console.log(`\nfleet update: ${repos.length} repo(s), ${failed} failing.`);
  return failed > 0 ? 1 : 0;
}

const USAGE = "usage: dienstweg fleet <status|check|update>";

// Dispatches the fleet subcommands. `args` is everything after `fleet` on the
// command line. `_root` is unused today (the fleet operates on the registry, not
// the cwd) but kept for signature symmetry with the other run* entry points.
export function runFleet(_root, args) {
  const [sub, ...rest] = args;
  if (rest.length) {
    console.error(`\`dienstweg fleet ${sub}\` takes no arguments (got: ${rest.join(" ")})`);
    return 1;
  }
  switch (sub) {
    case "status":
      return fleetStatus(readFleet());
    case "check":
      return fleetCheck(readFleet());
    case "update":
      return fleetUpdate(readFleet());
    case undefined:
      console.error(`fleet: missing subcommand.\n${USAGE}`);
      return 1;
    default:
      console.error(`fleet: unknown subcommand "${sub}".\n${USAGE}`);
      return 1;
  }
}
