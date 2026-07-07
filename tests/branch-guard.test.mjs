import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmp, cleanupAll, runGuard } from "./helpers.mjs";

after(cleanupAll);

// A project dir holding a minimal dienstweg.config.json the guard can find.
function project() {
  const dir = tmp("dienstweg-guard-");
  writeFileSync(
    join(dir, "dienstweg.config.json"),
    JSON.stringify({ git: { baseBranch: "main", protectedBranches: ["main"] } }),
  );
  return dir;
}

// A project dir that ALSO has the .dienstweg/ state dir, so the guard's decision
// log (DIE-8) has somewhere to land. `extra` merges into the config (e.g. to omit
// git.baseBranch for the fail-open path).
function loggingProject(extra = {}) {
  const dir = tmp("dienstweg-guard-log-");
  writeFileSync(
    join(dir, "dienstweg.config.json"),
    JSON.stringify({ git: { baseBranch: "main", protectedBranches: ["main"] }, ...extra }),
  );
  mkdirSync(join(dir, ".dienstweg"), { recursive: true });
  return dir;
}

// Parses the guard log written under a project dir into an array of entries.
function readGuardLog(dir) {
  const p = join(dir, ".dienstweg", "guard-log.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

// Commands that MUST be blocked (exit 2) - the real forms agents emit.
const BLOCK = [
  "git push origin main",
  "git push -u origin main",
  "git push origin HEAD:main",
  "git push origin +main",
  "git push origin :main",
  "git push --delete origin main",
  "git push --force origin main",
  "git push --force-with-lease origin main",
  "(git push origin main)",
  "git -C sub push origin main",
  "git commit --no-verify -m x",
  "git commit -nm wip",
  "gh pr create --base develop --title x",
  "gh pr create --title x",
  // Hard force on a non-protected branch must recommend --force-with-lease (DIE-6).
  "git push --force origin tasks/foo",
  "git push -f origin tasks/foo",
  "git push -fu origin tasks/foo",
  "git push origin +tasks/foo",
  "git push --force origin HEAD:tasks/foo",
  "git push --force",
  "git push -f",
  "git push --force origin",
  // Destructive no-undo git operations (DIE-5).
  "git reset --hard",
  "git reset --hard HEAD~2",
  "git clean -f",
  "git clean -fd",
  "git clean -xdf",
  "git checkout .",
  "git checkout -- .",
  "git restore .",
  "git restore --worktree .",
  "git stash drop",
  "git stash clear",
  "git branch -D tasks/die-5-foo",
  "git branch -D main",
  "git branch -Df tasks/die-5-foo",
  "git branch -fd tasks/die-5-foo",
  "git worktree remove --force .claude/worktrees/tasks+x",
  "git worktree remove -f .claude/worktrees/tasks+x",
  "git add . && git reset --hard",
  "git checkout HEAD -- .",
  "git checkout ./",
  "git restore -SW .",
  "git restore ./",
  "git -C sub clean -f",
  // Secret-file staging (DIE-7) - both payload shapes: plain add and force-add.
  "git add .env",
  "git add -f .env",
  "git add --force .env",
  "git add secrets/id_rsa",
  "git add config/prod.pem",
  "git add credentials.json",
  "git add path/to/.env.local",
  "git add -- .env",
  "git add src/app.js .env",
  "git -C sub add .env",
  // Case-insensitive: same file on macOS/Windows must not slip through (DIE-7).
  "git add CERT.PEM",
  "git add .ENV",
  "git add secrets/ID_RSA",
  // Pathspec staging magic still resolves to a real secret path (DIE-7).
  "git add :/.env",
  "git add :(top).env",
  "git add :(top,literal).env",
];

// Commands that MUST be allowed (exit 0) - legitimate look-alikes.
const ALLOW = [
  "git push -u origin tasks/foo",
  "git push origin main-hotfix",
  // --force-with-lease is the safe form and passes on non-protected branches (DIE-6).
  "git push --force-with-lease origin tasks/foo",
  "git push --force-with-lease=tasks/foo origin tasks/foo",
  "git push --force-with-lease",
  "git push origin tasks/foo",
  "gh pr create --base main --title x",
  'git commit -m "let us talk about main today"',
  "echo main",
  "git status",
  // Legitimate look-alikes of the destructive rules (DIE-5).
  "git reset --soft HEAD~1",
  "git reset HEAD file",
  "git clean -n",
  "git checkout main",
  "git checkout -b tasks/foo",
  "git checkout -- path/to/file",
  "git checkout -- ./src/file.js",
  "git restore --staged .",
  "git restore -S .",
  "git restore path/to/file",
  "git clean -nf",
  "git stash",
  "git stash pop",
  "git branch -d merged-feature",
  "git branch -D throwaway-experiment",
  "git worktree remove .claude/worktrees/tasks+x",
  "git worktree list",
  // Secret-file look-alikes and whole-tree adds stay allowed (DIE-7).
  "git add .env.example",
  "git add -f .env.example",
  "git add .env.sample",
  "git add src/app.js",
  "git add .",
  "git add -A",
  "git add -p",
  "git add README.md",
  "git add environment.ts",
  // Public key is safe; exclude-pathspec magic stages nothing (DIE-7).
  "git add id_rsa.pub",
  "git add secrets/id_rsa.pub",
  "git add . :!config.pem",
  "git add . :^config.pem",
  "git add . :(exclude)secret.pem",
];

const dir = project();

for (const via of ["claude", "codex"]) {
  test(`[${via}] blocks protected-branch / bypass commands`, () => {
    for (const cmd of BLOCK) {
      const { status, stderr } = runGuard(cmd, dir, via);
      assert.equal(status, 2, `should BLOCK: ${cmd}\nstderr: ${stderr}`);
      assert.match(stderr, /branch-guard\] BLOCKED/, `block reason for: ${cmd}`);
    }
  });

  test(`[${via}] allows legitimate commands`, () => {
    for (const cmd of ALLOW) {
      const { status } = runGuard(cmd, dir, via);
      assert.equal(status, 0, `should ALLOW: ${cmd}`);
    }
  });

  // AC #1: a hard force on a non-protected branch must recommend --force-with-lease,
  // not just block. Guards the recommendation message against a future regression.
  test(`[${via}] non-protected hard force recommends --force-with-lease`, () => {
    for (const cmd of ["git push --force origin tasks/foo", "git push --force"]) {
      const { status, stderr } = runGuard(cmd, dir, via);
      assert.equal(status, 2, `should BLOCK: ${cmd}`);
      assert.match(stderr, /--force-with-lease/, `should recommend lease for: ${cmd}`);
    }
  });
}

test("no config found -> guard allows (exit 0) and does not lock up work", () => {
  const empty = tmp("dienstweg-noconfig-");
  const { status } = runGuard("git push origin main", empty, "codex");
  assert.equal(status, 0);
});

// A project dir with a custom guard block for the secret denylist (DIE-7).
function guardProject(guard) {
  const dir = tmp("dienstweg-guard-cfg-");
  writeFileSync(
    join(dir, "dienstweg.config.json"),
    JSON.stringify({ git: { baseBranch: "main", protectedBranches: ["main"] }, guard }),
  );
  return dir;
}

// AC #3: the secret denylist can be extended or overridden via the config.
test("secret denylist: guard config extends the defaults", () => {
  const ext = guardProject({ secretDenylist: ["*.key"] });
  assert.equal(runGuard("git add .env", ext, "codex").status, 2, "default still blocks");
  assert.equal(runGuard("git add app.key", ext, "codex").status, 2, "extended pattern blocks");
  assert.equal(runGuard("git add app.js", ext, "codex").status, 0, "unrelated file allowed");
});

test("secret denylist: secretDenylistReplace overrides the defaults", () => {
  const rep = guardProject({ secretDenylist: ["*.key"], secretDenylistReplace: true });
  assert.equal(runGuard("git add .env", rep, "codex").status, 0, "default gone when replaced");
  assert.equal(runGuard("git add app.key", rep, "codex").status, 2, "replacement pattern blocks");
});

test("secret denylist: secretAllowlist exempts a would-be-denied file", () => {
  const alw = guardProject({ secretAllowlist: ["credentials.json"] });
  assert.equal(runGuard("git add credentials.json", alw, "codex").status, 0, "allowlisted file exempted");
  assert.equal(runGuard("git add credentials.yml", alw, "codex").status, 2, "non-exempt secret still blocked");
});

// A non-string denylist entry (config typo) must not crash the hook at load
// time - a crash would exit non-2/non-0 and fail OPEN for every rule.
test("secret denylist: a non-string config entry fails safe, not open", () => {
  const bad = guardProject({ secretDenylist: ["*.key", 123, null] });
  assert.equal(runGuard("git add .env", bad, "codex").status, 2, "default still blocks");
  assert.equal(runGuard("git add app.key", bad, "codex").status, 2, "valid custom pattern still blocks");
  assert.equal(runGuard("git push --force origin main", bad, "codex").status, 2, "unrelated rules still active");
});

// A replace list that filters to empty is a typo -> fall back to defaults; an
// explicitly empty list is honored as an opt-out.
test("secret denylist: replace with an all-typo list falls back to defaults", () => {
  const typo = guardProject({ secretDenylist: [123, null], secretDenylistReplace: true });
  assert.equal(runGuard("git add .env", typo, "codex").status, 2, "typo replace falls back to defaults");
  const optOut = guardProject({ secretDenylist: [], secretDenylistReplace: true });
  assert.equal(runGuard("git add .env", optOut, "codex").status, 0, "explicit empty replace opts out");
});

// --- DIE-8: guard decision log ------------------------------------------------

// AC #2: a blocked command appends exactly one JSON line carrying the rule's
// stable id, the "block" decision, a timestamp, and the (truncated) command.
test("guard log: a blocked command appends one block entry with a stable rule id", () => {
  const dir = loggingProject();
  assert.equal(runGuard("git push --force origin main", dir, "codex").status, 2);
  const log = readGuardLog(dir);
  assert.equal(log.length, 1, "exactly one line");
  assert.equal(log[0].decision, "block");
  assert.equal(log[0].rule, "push-force-protected");
  assert.equal(typeof log[0].ts, "string");
  assert.match(log[0].command, /git push --force origin main/);
});

// AC #2: the gh pr merge warning (non-blocking) is logged as a "warn" decision.
test("guard log: the gh pr merge warning appends a warn entry", () => {
  const dir = loggingProject();
  assert.equal(runGuard("gh pr merge 5", dir, "codex").status, 0, "warn does not block");
  const log = readGuardLog(dir);
  assert.equal(log.length, 1);
  assert.equal(log[0].decision, "warn");
  assert.equal(log[0].rule, "pr-merge-no-strategy");
});

// AC #2: a fail-open (config present but unusable) is logged as "fail-open" so an
// inert guard leaves a trace, even though it still allows the command.
test("guard log: a fail-open (config missing baseBranch) appends a fail-open entry", () => {
  const dir = loggingProject({ git: { protectedBranches: ["main"] } }); // no baseBranch
  assert.equal(runGuard("git push origin main", dir, "codex").status, 0, "fails open");
  const log = readGuardLog(dir);
  assert.equal(log.length, 1);
  assert.equal(log[0].decision, "fail-open");
  assert.equal(log[0].rule, "config-unreadable");
});

// AC #2: "silent on write failure" - with no .dienstweg/ dir the append throws
// ENOENT, which must be swallowed: the block/allow decision and exit code are
// unchanged and no file is created.
test("guard log: silent when the log dir is absent (no crash, no file)", () => {
  const dir = project(); // no .dienstweg/
  assert.equal(runGuard("git reset --hard", dir, "codex").status, 2, "still blocks, no crash");
  assert.ok(!existsSync(join(dir, ".dienstweg", "guard-log.jsonl")), "no log file created");
});

// AC #1: every rule has a stable id. One representative command per block rule
// asserts the exact id it logs - a rename would fail here.
test("guard log: every block rule logs its stable id", () => {
  const cases = [
    ["gh pr create --title x", "pr-base-missing"],
    ["gh pr create --base develop --title x", "pr-base-mismatch"],
    ["git commit --no-verify -m x", "commit-no-verify"],
    ["git push --force origin tasks/foo", "push-force-nonprotected"],
    ["git push --delete origin main", "push-delete-protected"],
    ["git push --force origin main", "push-force-protected"],
    ["git push origin main", "push-protected"],
    ["git push --force", "push-force-bare"],
    ["git reset --hard", "reset-hard"],
    ["git clean -f", "clean-force"],
    ["git checkout .", "checkout-worktree-wide"],
    ["git restore .", "restore-worktree-wide"],
    ["git stash drop", "stash-drop-clear"],
    ["git branch -D main", "branch-force-delete"],
    ["git worktree remove --force x", "worktree-remove-force"],
    ["git add .env", "add-secret"],
  ];
  for (const [cmd, rule] of cases) {
    const dir = loggingProject();
    assert.equal(runGuard(cmd, dir, "codex").status, 2, `should block: ${cmd}`);
    const log = readGuardLog(dir);
    assert.equal(log.length, 1, `one entry for: ${cmd}`);
    assert.equal(log[0].decision, "block", `block decision for: ${cmd}`);
    assert.equal(log[0].rule, rule, `rule id for: ${cmd}`);
  }
});

// Inline URL credentials must not be persisted verbatim (this guard's own job
// includes secret hygiene, so its log must not leak a token).
test("guard log: inline URL credentials are redacted before logging", () => {
  const dir = loggingProject();
  // reset --hard blocks unambiguously; the credential rides along in the command.
  runGuard("git reset --hard https://alice:s3cr3t-token@github.com/o/r", dir, "codex");
  const log = readGuardLog(dir);
  assert.equal(log.length, 1);
  assert.doesNotMatch(log[0].command, /s3cr3t-token/, "the token must not appear");
  assert.match(log[0].command, /alice:\*\*\*@/, "the credential is redacted");
});

// The logged command is truncated so a runaway one-liner cannot bloat the log.
test("guard log: the logged command is truncated to 500 chars", () => {
  const dir = loggingProject();
  const long = "git push origin main " + "x".repeat(600);
  assert.equal(runGuard(long, dir, "codex").status, 2);
  const log = readGuardLog(dir);
  assert.equal(log.length, 1);
  assert.ok(log[0].command.length <= 500, `command length ${log[0].command.length} <= 500`);
});
