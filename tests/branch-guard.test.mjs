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
  "git restore -SW .",
  "git -C sub clean -f",
];

// Commands that MUST be allowed (exit 0) - legitimate look-alikes.
const ALLOW = [
  "git push -u origin tasks/foo",
  "git push origin main-hotfix",
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
}

test("no config found -> guard allows (exit 0) and does not lock up work", () => {
  const empty = tmp("dienstweg-noconfig-");
  const { status } = runGuard("git push origin main", empty, "codex");
  assert.equal(status, 0);
});
