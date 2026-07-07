import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
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
