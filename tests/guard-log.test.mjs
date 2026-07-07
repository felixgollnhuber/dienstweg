import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, tmpRepo, cleanupAll, runCli } from "./helpers.mjs";
import {
  guardLogDiagnostics,
  readGuardLog,
  guardLogPath,
  GUARD_LOG_GITIGNORE_ENTRY,
} from "../src/guard-log.mjs";

after(cleanupAll);

// A fixed "now" so the recency window is deterministic (no Date.now() flake).
const NOW = Date.parse("2026-07-07T12:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

// Writes the given entries as a jsonl guard log under `root`. `rawLines` appends
// verbatim strings (for malformed-line coverage).
function writeLog(root, entries, rawLines = []) {
  mkdirSync(join(root, ".dienstweg"), { recursive: true });
  const lines = [...entries.map((e) => JSON.stringify(e)), ...rawLines];
  writeFileSync(guardLogPath(root), lines.join("\n") + "\n");
}

test("guardLogDiagnostics: recent blocks are summarized per rule as one INFO", () => {
  const dir = tmp("dienstweg-gl-");
  writeLog(dir, [
    { ts: ago(1000), rule: "push-protected", decision: "block", command: "git push origin main" },
    { ts: ago(2000), rule: "push-protected", decision: "block", command: "git push origin main" },
    { ts: ago(3000), rule: "add-secret", decision: "block", command: "git add .env" },
  ]);
  const { infos, problems } = guardLogDiagnostics(dir, NOW);
  assert.equal(problems.length, 0);
  assert.equal(infos.length, 1);
  assert.match(infos[0], /3 recent block\(s\)/);
  assert.match(infos[0], /push-protected \(2\)/);
  assert.match(infos[0], /add-secret \(1\)/);
});

test("guardLogDiagnostics: fail-open events are a FAIL problem", () => {
  const dir = tmp("dienstweg-gl-");
  writeLog(dir, [
    { ts: ago(1000), rule: "config-unreadable", decision: "fail-open", command: "git push origin main" },
  ]);
  const { infos, problems } = guardLogDiagnostics(dir, NOW);
  assert.equal(infos.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /fell open 1 time/);
});

test("guardLogDiagnostics: blocks (INFO) and fail-open (FAIL) coexist", () => {
  const dir = tmp("dienstweg-gl-");
  writeLog(dir, [
    { ts: ago(1000), rule: "reset-hard", decision: "block", command: "git reset --hard" },
    { ts: ago(2000), rule: "config-unreadable", decision: "fail-open", command: "git push origin main" },
  ]);
  const { infos, problems } = guardLogDiagnostics(dir, NOW);
  assert.equal(infos.length, 1);
  assert.equal(problems.length, 1);
});

test("readGuardLog: malformed lines and out-of-window entries are skipped", () => {
  const dir = tmp("dienstweg-gl-");
  writeLog(
    dir,
    [
      { ts: ago(1000), rule: "push-protected", decision: "block" },
      { ts: ago(30 * DAY), rule: "add-secret", decision: "block" }, // out of the 7d window
      { rule: "no-ts", decision: "block" }, // missing ts -> dropped
    ],
    ["{ not valid json", "   "],
  );
  const entries = readGuardLog(dir, NOW);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].rule, "push-protected");
});

test("guardLogDiagnostics: no log file -> no diagnostics, never throws", () => {
  const dir = tmp("dienstweg-gl-empty-");
  const { infos, problems } = guardLogDiagnostics(dir, NOW);
  assert.equal(infos.length, 0);
  assert.equal(problems.length, 0);
});

// AC #3 end-to-end: a recent fail-open makes `dienstweg check` FAIL (exit 1) and
// name the event; a recent block surfaces as an INFO while check still passes.
test("check reports a fail-open event as FAIL (exit 1)", () => {
  const root = tmpRepo();
  assert.equal(runCli(["init", "--yes", "--harness", "both", "--name", "d", "--prefix", "D"], root).status, 0);
  assert.equal(runCli(["check"], root).status, 0, "clean before any log");
  writeFileSync(
    guardLogPath(root),
    JSON.stringify({ ts: new Date().toISOString(), rule: "config-unreadable", decision: "fail-open", command: "git push origin main" }) + "\n",
  );
  const chk = runCli(["check"], root);
  assert.equal(chk.status, 1, chk.stdout + chk.stderr);
  assert.match(chk.stderr, /fell open/);
});

test("check summarizes recent blocks as INFO (still exit 0)", () => {
  const root = tmpRepo();
  runCli(["init", "--yes", "--harness", "both", "--name", "d", "--prefix", "D"], root);
  writeFileSync(
    guardLogPath(root),
    JSON.stringify({ ts: new Date().toISOString(), rule: "push-protected", decision: "block", command: "git push origin main" }) + "\n",
  );
  const chk = runCli(["check"], root);
  assert.equal(chk.status, 0, chk.stdout + chk.stderr);
  assert.match(chk.stdout, /recent block\(s\)/);
  assert.match(chk.stdout, /push-protected \(1\)/);
});

// AC #4 end-to-end: init gitignores the guard log so it never enters git; a
// second update stays idempotent (the entry is added once, not duplicated).
test("init gitignores the guard log, and update keeps it idempotent", () => {
  const root = tmpRepo();
  runCli(["init", "--yes", "--harness", "both", "--name", "d", "--prefix", "D"], root);
  const gitignorePath = join(root, ".gitignore");
  const afterInit = readFileSync(gitignorePath, "utf8").split(/\r?\n/);
  assert.ok(afterInit.includes(GUARD_LOG_GITIGNORE_ENTRY), "init gitignores the log");

  runCli(["update", "--force"], root);
  const afterUpdate = readFileSync(gitignorePath, "utf8").split(/\r?\n/);
  assert.equal(
    afterUpdate.filter((l) => l === GUARD_LOG_GITIGNORE_ENTRY).length,
    1,
    "the entry appears exactly once after update",
  );
});
