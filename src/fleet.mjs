import { computeCheck } from "./check.mjs";
import { runUpdate } from "./update.mjs";
import { readFleet } from "./registry.mjs";

// The fleet command surface: runs the existing single-repo commands across every
// registered repo and aggregates the results. The registry itself lives in
// registry.mjs (imported by init/update too); this module depends on it and on
// the single-repo runners, keeping the imports one-directional.

function pluralConflicts(n) {
  return `${n} conflict${n === 1 ? "" : "s"}`;
}

const EMPTY_MSG = "fleet: no repos registered - run `dienstweg init` or `dienstweg update` in a repo.";

// `fleet status`: one line per repo - stamped dienstwegVersion vs CLI version,
// check result (OK/FAIL), conflict count. Purely a report, so it always exits 0.
function fleetStatus(repos) {
  if (repos.length === 0) {
    console.log(EMPTY_MSG);
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
    console.log(EMPTY_MSG);
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
    console.log(EMPTY_MSG);
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
  const known = { status: fleetStatus, check: fleetCheck, update: fleetUpdate };
  if (sub === undefined) {
    console.error(`fleet: missing subcommand.\n${USAGE}`);
    return 1;
  }
  const handler = known[sub];
  if (!handler) {
    console.error(`fleet: unknown subcommand "${sub}".\n${USAGE}`);
    return 1;
  }
  if (rest.length) {
    console.error(`\`dienstweg fleet ${sub}\` takes no arguments (got: ${rest.join(" ")})`);
    return 1;
  }
  return handler(readFleet());
}
