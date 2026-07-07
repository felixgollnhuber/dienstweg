import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { CONFIG_FILENAME } from "./config.mjs";

// The user-level registry of repos that use dienstweg. This module is the
// registry layer only (no command orchestration), so init/update can import it
// without pulling in the fleet command surface - which keeps the imports
// one-directional (registry <- fleet, registry <- init/update).

const FLEET_VERSION = 1;

// Location of the registry. Honors XDG_CONFIG_HOME (falling back to ~/.config),
// but only when it is an absolute path - the XDG spec says a relative value must
// be ignored, and since `fleet` runs from any cwd, honoring a relative value
// would scatter the registry per invocation directory. Resolved per call, never
// cached, so an env change between calls (tests, subprocesses) takes effect.
export function fleetPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const configHome = xdg && xdg.trim() && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
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

// Writes the registry atomically (temp file + rename) so a concurrent reader
// never sees a half-written file and two overlapping writers can't tear the
// JSON. The temp name is process-scoped to avoid collisions between concurrent
// writers. Note this does not close the read-modify-write lost-update window in
// registerRepo (a dropped registration self-heals on the repo's next update).
export function writeFleet(repos) {
  const p = fleetPath();
  mkdirSync(dirname(p), { recursive: true });
  const sorted = [...new Set(repos)].sort();
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: FLEET_VERSION, repos: sorted }, null, 2) + "\n");
  renameSync(tmp, p);
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
