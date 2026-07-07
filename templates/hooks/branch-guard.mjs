#!/usr/bin/env node
// branch-guard hook: a guardrail against the most common accidental git-rule
// violations. Reads the PreToolUse payload from stdin, emits feedback to stderr
// and exits with code 2 to BLOCK. Exit 0 = allow.
//
// Harness-neutral: Claude Code and Codex both send a PreToolUse payload with the
// shell command in `tool_input.command`, and both treat `exit 2` + stderr as a
// deny. The same rendered script therefore works, unchanged, in either harness.
//
// Scope and honesty: this is NOT a security sandbox. It parses the command
// string well enough to catch the everyday mistakes an agent makes (wrong PR
// base, push to a protected branch, --no-verify, force push). It deliberately
// does not try to defeat obfuscation (nested command substitution, base64, an
// external script). A determined bypass is always possible; that is fine,
// because the goal is to stop honest mistakes, not to contain a hostile actor.
//
// Rules come from dienstweg.config.json at runtime (git.baseBranch,
// git.protectedBranches). If the config cannot be found or parsed, the hook
// warns and allows - a broken config must not lock up unrelated work; run
// `dienstweg check` to surface it.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const NAME = "branch-guard";

function findConfig(payloadCwd) {
  // Claude Code exposes CLAUDE_PROJECT_DIR; Codex exposes no project-dir env var
  // but carries the session cwd in the payload. Walk up from each known start so
  // the config is found whether the hook runs at the repo root or a subdir.
  const starts = [];
  if (process.env.CLAUDE_PROJECT_DIR) starts.push(process.env.CLAUDE_PROJECT_DIR);
  if (payloadCwd) starts.push(payloadCwd);
  starts.push(process.cwd());

  const candidates = [];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 20; i++) {
      candidates.push(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const c of candidates) {
    const p = join(c, "dienstweg.config.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return null;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function block(reason) {
  process.stderr.write(`[${NAME}] BLOCKED: ${reason}\n`);
  process.exit(2);
}

// Remove heredoc bodies (commit messages, file contents) so their text cannot
// trigger false positives.
function stripHeredocs(s) {
  return s.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\b\1\b/g, " ");
}

// Unwrap quotes around single tokens so `"main"` is still seen as the argument
// `main`, but blank out multi-word quoted strings (commit messages, PR titles)
// so their contents cannot cause false positives. This closes the common
// `git push origin "main"` / `git commit "--no-verify"` accidental bypass
// without pretending to be a shell parser.
function normalizeQuotes(s) {
  s = s.replace(/"([^"]*)"/g, (_, inner) => (/\s/.test(inner) ? " " : inner));
  s = s.replace(/'([^']*)'/g, (_, inner) => (/\s/.test(inner) ? " " : inner));
  return s;
}

// Split a compound command into independent segments on shell control
// operators, so a rule matching one segment cannot span into another
// (e.g. `git push ... && git checkout main` is two segments, not one).
function segments(s) {
  return s
    .split(/&&|\|\||[;|&\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function tokenize(seg) {
  // Strip surrounding shell grouping so `(git push origin main)` and
  // `(cd x && git push origin main)` tokenize to bare `git ... main`.
  return seg
    .split(/\s+/)
    .map((t) => t.replace(/^[({]+/, "").replace(/[)}]+$/, ""))
    .filter(Boolean);
}

// Returns the argument tokens after a git subcommand, tolerating global options
// between `git` and the subcommand (`git -C dir push ...`, `git --no-pager ...`).
// Returns null if this segment is not that git subcommand.
function afterGitSub(seg, sub) {
  const t = tokenize(seg);
  const gi = t.indexOf("git");
  if (gi === -1) return null;
  let i = gi + 1;
  const takesArg = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
  while (i < t.length) {
    const x = t[i];
    if (takesArg.has(x)) {
      i += 2;
      continue;
    }
    if (x.startsWith("-")) {
      i += 1;
      continue;
    }
    break;
  }
  if (t[i] !== sub) return null;
  return t.slice(i + 1);
}

function afterGhPr(seg, action) {
  const t = tokenize(seg);
  const gi = t.indexOf("gh");
  if (gi === -1) return null;
  if (t[gi + 1] !== "pr" || t[gi + 2] !== action) return null;
  return t.slice(gi + 3);
}

// Destination branch of a refspec: `+src:dst`, `src:dst`, `:dst` (delete) or
// `dst`, with a `refs/heads/` prefix stripped.
function refspecDest(refspec) {
  const r = refspec.replace(/^\+/, "");
  const colon = r.indexOf(":");
  const dst = colon === -1 ? r : r.slice(colon + 1);
  return dst.replace(/^refs\/heads\//, "");
}

const raw = readStdin();
if (!raw.trim()) process.exit(0);

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const command = payload?.tool_input?.command;
if (typeof command !== "string") process.exit(0);

let config = null;
try {
  config = findConfig(typeof payload?.cwd === "string" ? payload.cwd : null);
} catch {
  config = null;
}
if (!config?.git?.baseBranch) {
  process.stderr.write(`[${NAME}] WARN: dienstweg.config.json not found/invalid - allowing. Run \`dienstweg check\`.\n`);
  process.exit(0);
}

const prBase = config.git.baseBranch;
const protectedSet = new Set(
  config.git.protectedBranches?.length ? config.git.protectedBranches : [prBase],
);

const prepared = normalizeQuotes(stripHeredocs(command));

for (const seg of segments(prepared)) {
  // A short option cluster like `-fd` (single dash, not a `--long` flag); lets the
  // rules below catch bundled short flags (`-fu`, `-xdf`, `-Df`), not just the lone form.
  const isShort = (a) => a.startsWith("-") && !a.startsWith("--");

  // Rule 1/2: gh pr create must target the configured base branch explicitly.
  const createArgs = afterGhPr(seg, "create");
  if (createArgs && !createArgs.includes("--help") && !createArgs.includes("-h")) {
    const bases = [];
    for (let i = 0; i < createArgs.length; i++) {
      const a = createArgs[i];
      if (a === "--base" || a === "-B") {
        if (createArgs[i + 1]) bases.push(createArgs[i + 1]);
      } else if (a.startsWith("--base=")) {
        bases.push(a.slice("--base=".length));
      } else if (a.startsWith("-B=")) {
        bases.push(a.slice("-B=".length));
      }
    }
    if (bases.length === 0) {
      block(`gh pr create without --base is forbidden. Pass --base ${prBase} explicitly. See the dienstweg block in AGENTS.md.`);
    }
    const base = bases[bases.length - 1];
    if (base !== prBase) {
      block(`gh pr create --base ${base} is forbidden. PRs must target '${prBase}'. See the dienstweg block in AGENTS.md.`);
    }
  }

  // Rule 3: git commit --no-verify / -n bypasses hooks and signing. Also
  // catches the bundled short form (`-nm "msg"` == `--no-verify -m msg`).
  const commitArgs = afterGitSub(seg, "commit");
  if (
    commitArgs &&
    commitArgs.some((a) => a === "--no-verify" || (/^-[a-zA-Z]*n[a-zA-Z]*$/.test(a) && !a.startsWith("--")))
  ) {
    block(`git commit --no-verify is forbidden unless the user explicitly requested it. If a hook fails, investigate and fix the underlying issue.`);
  }

  // Rule 4/5: pushes to protected branches (force = worse, but both blocked).
  const pushArgs = afterGitSub(seg, "push");
  if (pushArgs) {
    // `-f`, and bundled short clusters like `-fu` (force + set-upstream) or `-fq`;
    // `-f` is the only push short flag spelled with an `f`, so a cluster with one forces.
    const hardForce = pushArgs.some((a) => a === "--force" || (isShort(a) && a.includes("f")));
    const withLease = pushArgs.some((a) => a === "--force-with-lease" || a.startsWith("--force-with-lease="));
    const isDelete = pushArgs.some((a) => a === "--delete" || a === "-d");
    const nonFlags = pushArgs.filter((a) => !a.startsWith("-"));
    // Explicit refspecs carry their own destination regardless of position
    // (`:main`, `+main`, `HEAD:main`, `main:main`).
    const explicitRefspecs = nonFlags.filter((a) => a.startsWith("+") || a.includes(":"));
    // Plain tokens: the first is the remote, the rest are branch refspecs.
    // With --delete the remote is ambiguous, so treat every plain token as a
    // candidate branch (a remote literally named for a protected branch is absurd).
    const plain = nonFlags.filter((a) => !a.startsWith("+") && !a.includes(":"));
    const branchRefspecs = isDelete ? plain : plain.slice(1);
    const plusForce = explicitRefspecs.some((a) => a.startsWith("+"));
    const force = hardForce || withLease || plusForce;
    const forceLabel = hardForce || plusForce ? "--force" : "--force-with-lease";
    // A hard force (--force/-f, or a +refspec that force-updates just that ref)
    // can silently overwrite commits the pusher never fetched; --force-with-lease
    // refuses when the remote moved and is the required form on any shared branch.
    const leaseHint =
      "Use --force-with-lease instead - it refuses when the remote moved. See the dienstweg block in AGENTS.md.";
    for (const c of [...explicitRefspecs, ...branchRefspecs]) {
      const dst = refspecDest(c);
      const hardForceHere = hardForce || c.startsWith("+");
      if (!protectedSet.has(dst)) {
        // Non-protected branch: steer a hard force to the leased form; a leased
        // force (--force-with-lease) or a plain push stays allowed.
        if (hardForceHere) block(`git push --force to '${dst}' can overwrite commits you have not fetched. ${leaseHint}`);
        continue;
      }
      if (isDelete) block(`Deleting the protected branch '${dst}' on the remote is forbidden.`);
      if (force) block(`git push ${forceLabel} to '${dst}' is destructive on a shared branch and requires explicit user authorization.`);
      block(`Direct push to '${dst}' is forbidden. Integration happens via PR (base ${prBase}).`);
    }
    // A bare hard force with no branch refspec (destination unknown): --force is
    // never preferable to --force-with-lease, so steer to the safe form. A bare
    // --force-with-lease has hardForce === false and is left alone.
    if (hardForce && explicitRefspecs.length === 0 && branchRefspecs.length === 0) {
      block(`git push --force can overwrite commits you have not fetched. ${leaseHint}`);
    }
  }

  // Rule 6: gh pr merge without an explicit strategy drifts from the convention.
  const mergeArgs = afterGhPr(seg, "merge");
  if (mergeArgs && !mergeArgs.some((a) => a === "--squash" || a === "--merge" || a === "--rebase")) {
    process.stderr.write(`[${NAME}] WARN: gh pr merge without an explicit strategy. Convention is --squash --delete-branch. Continuing.\n`);
  }

  // Rules 7-12 catch destructive git operations that throw away uncommitted or
  // in-progress work with no undo. These are honest-mistake guards, not a
  // sandbox: a determined bypass is always possible.

  // Rule 7: git reset --hard discards every uncommitted change with no undo.
  const resetArgs = afterGitSub(seg, "reset");
  if (resetArgs && resetArgs.includes("--hard")) {
    block(`git reset --hard discards all uncommitted changes with no undo and requires explicit user authorization.`);
  }

  // Rule 8: git clean -f permanently deletes untracked files (bundled short
  // forms like -fd / -xdf included). A dry run (-n / --dry-run) deletes nothing.
  const cleanArgs = afterGitSub(seg, "clean");
  if (cleanArgs) {
    const cleanForce = cleanArgs.some((a) => a === "--force" || (isShort(a) && a.includes("f")));
    const cleanDryRun = cleanArgs.some((a) => a === "--dry-run" || (isShort(a) && a.includes("n")));
    if (cleanForce && !cleanDryRun) {
      block(`git clean -f permanently deletes untracked files with no undo and requires explicit user authorization.`);
    }
  }

  // Rule 9: repo-wide working-tree discard throws away every uncommitted change.
  // `git checkout .` / `git checkout -- .` and `git restore .` (worktree). A
  // targeted path (`git checkout -- file`) or a staged-only restore
  // (`git restore --staged .`, which only unstages and loses no work) stays fine.
  // The current-directory pathspec, written `.` or `./` - both discard the whole
  // (sub)tree; a named path like `./file` or `path/to/file` stays targeted.
  const isCwdPathspec = (a) => a === "." || a === "./";
  const coArgs = afterGitSub(seg, "checkout");
  if (coArgs && coArgs.some(isCwdPathspec)) {
    block(`Repo-wide 'git checkout .' discards all uncommitted working-tree changes with no undo and requires explicit user authorization.`);
  }
  const restoreArgs = afterGitSub(seg, "restore");
  if (restoreArgs && restoreArgs.some(isCwdPathspec)) {
    const staged = restoreArgs.some((a) => a === "--staged" || (isShort(a) && a.includes("S")));
    const worktree = restoreArgs.some((a) => a === "--worktree" || (isShort(a) && a.includes("W")));
    // The default target when neither flag is present is the working tree.
    if (worktree || !staged) {
      block(`Repo-wide 'git restore .' discards all uncommitted working-tree changes with no undo and requires explicit user authorization.`);
    }
  }

  // Rule 10: git stash drop / clear permanently removes stashed work.
  const stashArgs = afterGitSub(seg, "stash");
  if (stashArgs && (stashArgs[0] === "drop" || stashArgs[0] === "clear")) {
    block(`git stash ${stashArgs[0]} permanently removes stashed work with no undo and requires explicit user authorization.`);
  }

  // Rule 11: git branch -D force-deletes a branch even when unmerged. Guard the
  // branches that carry work: tasks/* feature branches and protected branches.
  const branchArgs = afterGitSub(seg, "branch");
  if (branchArgs) {
    // Force-delete is `-D` (incl. bundled forms like -Df), or a `-d`/--delete
    // paired with a `-f`/--force, incl. short clusters like -fd / -df. `-D` is
    // uppercase, so it is matched case-sensitively and separately from `-d`.
    const capD = branchArgs.some((a) => isShort(a) && a.includes("D"));
    const del = branchArgs.some((a) => a === "--delete" || (isShort(a) && a.includes("d")));
    const force = branchArgs.some((a) => a === "--force" || (isShort(a) && a.includes("f")));
    const forceDelete = capD || (del && force);
    if (forceDelete) {
      for (const target of branchArgs.filter((a) => !a.startsWith("-"))) {
        if (target.startsWith("tasks/") || protectedSet.has(target)) {
          block(`git branch -D of '${target}' force-deletes an unmerged branch with no undo and requires explicit user authorization.`);
        }
      }
    }
  }

  // Rule 12: git worktree remove --force deletes a worktree that still holds
  // uncommitted changes. Without --force git refuses on a dirty worktree, so
  // only the forced form is destructive.
  const wtArgs = afterGitSub(seg, "worktree");
  if (wtArgs && wtArgs[0] === "remove" && wtArgs.some((a) => a === "--force" || /^-f+$/.test(a))) {
    block(`git worktree remove --force deletes a worktree with uncommitted changes and requires explicit user authorization.`);
  }
}

process.exit(0);
