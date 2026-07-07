import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmp, tmpRepo, runCli, fleetFile, cleanupAll } from "./helpers.mjs";
import {
  fleetPath,
  loadFleet,
  readFleet,
  writeFleet,
  registerRepo,
  isLiveRepo,
} from "../src/fleet.mjs";

after(cleanupAll);

// Points the fleet registry at a throwaway XDG home for an in-process test and
// returns it. Each test gets its own home so the module-level env read is
// deterministic.
function useTempConfigHome() {
  const home = tmp("dienstweg-xdg-unit-");
  process.env.XDG_CONFIG_HOME = home;
  return home;
}

// A directory that satisfies isLiveRepo (exists + carries a dienstweg config)
// without a full init - enough for registry maintenance tests.
function fakeRepo() {
  const dir = tmp("dienstweg-fake-repo-");
  writeFileSync(join(dir, "dienstweg.config.json"), "{}\n");
  return dir;
}

const readRegistry = (home) => JSON.parse(readFileSync(fleetFile(home), "utf8"));

// ---------------------------------------------------------------------------
// Registry maintenance (in-process)
// ---------------------------------------------------------------------------

test("fleetPath honors XDG_CONFIG_HOME", () => {
  const home = useTempConfigHome();
  assert.equal(fleetPath(), join(home, "dienstweg", "fleet.json"));
});

test("loadFleet tolerates a missing registry", () => {
  useTempConfigHome();
  assert.deepEqual(loadFleet().repos, []);
});

test("loadFleet tolerates a corrupt registry", () => {
  const home = useTempConfigHome();
  const p = fleetFile(home);
  mkdirSync(join(home, "dienstweg"), { recursive: true });
  writeFileSync(p, "{ not json");
  assert.deepEqual(loadFleet().repos, []);
});

test("registerRepo creates the registry, stores an absolute path, and dedupes", () => {
  const home = useTempConfigHome();
  const repo = fakeRepo();

  assert.equal(registerRepo(repo), true);
  assert.ok(existsSync(fleetFile(home)), "registry file created");
  assert.deepEqual(readRegistry(home).repos, [resolve(repo)]);

  // Idempotent: registering the same repo again does not duplicate it.
  assert.equal(registerRepo(repo), true);
  assert.deepEqual(loadFleet().repos, [resolve(repo)]);
});

test("readFleet prunes dead paths (missing dir OR missing config) and persists", () => {
  const home = useTempConfigHome();
  const live = fakeRepo();
  const goneDir = fakeRepo();
  const noConfig = tmp("dienstweg-noconfig-"); // exists but has no config

  writeFleet([resolve(live), resolve(goneDir), resolve(noConfig)]);
  rmSync(goneDir, { recursive: true, force: true });

  assert.equal(isLiveRepo(resolve(live)), true);
  assert.equal(isLiveRepo(resolve(goneDir)), false);
  assert.equal(isLiveRepo(resolve(noConfig)), false);

  const live2 = readFleet();
  assert.deepEqual(live2, [resolve(live)]);
  // The pruned set is persisted, not just returned.
  assert.deepEqual(readRegistry(home).repos, [resolve(live)]);
});

// ---------------------------------------------------------------------------
// init / update registration (subprocess)
// ---------------------------------------------------------------------------

test("init registers the repo in the fleet registry", () => {
  const home = tmp("dienstweg-xdg-init-");
  const repo = tmpRepo();
  const env = { XDG_CONFIG_HOME: home };
  assert.equal(runCli(["init", "--yes", "--harness", "both", "--name", "d", "--prefix", "D"], repo, { env }).status, 0);

  const repos = readRegistry(home).repos;
  assert.equal(repos.length, 1);
  assert.equal(realpathSync(repos[0]), realpathSync(repo), "the registered path is this repo");
});

test("update registers a repo missing from the registry", () => {
  const home = tmp("dienstweg-xdg-update-");
  const repo = tmpRepo();
  const env = { XDG_CONFIG_HOME: home };
  runCli(["init", "--yes", "--harness", "claude", "--name", "d", "--prefix", "D"], repo, { env });

  // Drop the registry entirely; update must re-add the repo.
  rmSync(fleetFile(home), { force: true });
  assert.equal(runCli(["update"], repo, { env }).status, 0);
  assert.equal(readRegistry(home).repos.length, 1);
});

// ---------------------------------------------------------------------------
// fleet status / check / update (subprocess)
// ---------------------------------------------------------------------------

test("fleet status: one line per repo with version, result, conflict count", () => {
  const home = tmp("dienstweg-xdg-status-");
  const env = { XDG_CONFIG_HOME: home };
  const repo = tmpRepo();
  runCli(["init", "--yes", "--harness", "both", "--name", "d", "--prefix", "D"], repo, { env });

  const stored = readRegistry(home).repos[0];
  const status = runCli(["fleet", "status"], tmp(), { env });
  assert.equal(status.status, 0);
  assert.match(status.stdout, /OK/);
  assert.match(status.stdout, /0 conflicts/);
  assert.ok(status.stdout.includes(stored), "the repo path is listed");
});

test("fleet status: a hand-edited generated file shows FAIL + a non-zero conflict count", () => {
  const home = tmp("dienstweg-xdg-status2-");
  const env = { XDG_CONFIG_HOME: home };
  const repo = tmpRepo();
  runCli(["init", "--yes", "--harness", "both", "--name", "d", "--prefix", "D"], repo, { env });

  // Tamper with a manifest-tracked generated file.
  const gen = join(repo, ".claude", "commands", "create-issue.md");
  writeFileSync(gen, readFileSync(gen, "utf8") + "\nhand edit\n");

  const status = runCli(["fleet", "status"], tmp(), { env });
  assert.equal(status.status, 0, "status is a report - always exits 0");
  assert.match(status.stdout, /FAIL/);
  assert.match(status.stdout, /1 conflict\b/);
});

test("fleet check: exit 0 when all pass, non-zero when any fails", () => {
  const home = tmp("dienstweg-xdg-check-");
  const env = { XDG_CONFIG_HOME: home };
  const repo = tmpRepo();
  runCli(["init", "--yes", "--harness", "both", "--name", "d", "--prefix", "D"], repo, { env });

  const clean = runCli(["fleet", "check"], tmp(), { env });
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(clean.stdout, /0 failing/);

  // Break the repo, then re-check.
  const gen = join(repo, ".claude", "commands", "start-task.md");
  writeFileSync(gen, readFileSync(gen, "utf8") + "\nbroken\n");
  const broken = runCli(["fleet", "check"], tmp(), { env });
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /1 failing/);
});

test("fleet update: runs update across repos; non-zero if any fails", () => {
  const home = useTempConfigHome();
  const env = { XDG_CONFIG_HOME: home };
  const repo = tmpRepo();
  runCli(["init", "--yes", "--harness", "claude", "--name", "d", "--prefix", "D"], repo, { env });

  // A live-but-broken repo (config from a newer schema) makes update fail. It is
  // registered in-process against the same home the subprocess reads.
  const broken = tmpRepo();
  writeFileSync(join(broken, "dienstweg.config.json"), JSON.stringify({ schemaVersion: 999 }) + "\n");
  assert.equal(registerRepo(broken), true);

  const res = runCli(["fleet", "update"], tmp(), { env });
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stdout, /1 failing/);
  assert.ok(res.stdout.includes(`== ${resolve(repo)}`) || res.stdout.includes("=="), "prints a per-repo header");
});

test("fleet status: reports an empty registry cleanly", () => {
  const home = tmp("dienstweg-xdg-empty-");
  const env = { XDG_CONFIG_HOME: home };
  const res = runCli(["fleet", "status"], tmp(), { env });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /no repos registered/);
});

test("fleet: unknown subcommand exits non-zero with usage", () => {
  const res = runCli(["fleet", "frobnicate"], tmp());
  assert.equal(res.status, 1);
  assert.match(res.stderr, /unknown subcommand/);
});

// ---------------------------------------------------------------------------
// check --json (subprocess)
// ---------------------------------------------------------------------------

test("check --json emits machine-readable output", () => {
  const home = tmp("dienstweg-xdg-json-");
  const env = { XDG_CONFIG_HOME: home };
  const repo = tmpRepo();
  runCli(["init", "--yes", "--harness", "both", "--name", "d", "--prefix", "D"], repo, { env });

  const res = runCli(["check", "--json"], repo, { env });
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.conflicts, 0);
  assert.ok(parsed.cliVersion, "carries the CLI version");
  assert.ok("dienstwegVersion" in parsed);
  assert.ok(Array.isArray(parsed.problems));

  // A conflict is reflected as ok:false with a non-zero conflict count.
  const gen = join(repo, ".claude", "commands", "create-issue.md");
  writeFileSync(gen, readFileSync(gen, "utf8") + "\nedit\n");
  const bad = runCli(["check", "--json"], repo, { env });
  assert.equal(bad.status, 1);
  const badParsed = JSON.parse(bad.stdout);
  assert.equal(badParsed.ok, false);
  assert.ok(badParsed.conflicts >= 1);
});

test("check --json rejects unknown flags", () => {
  const repo = tmpRepo();
  const res = runCli(["check", "--bogus"], repo);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /only supports --json/);
});
