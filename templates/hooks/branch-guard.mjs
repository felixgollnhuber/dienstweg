#!/usr/bin/env node
// branch-guard hook: a guardrail against the most common accidental git-rule
// violations. Reads the PreToolUse payload from stdin, emits feedback to stderr
// and exits with code 2 to BLOCK. Exit 0 = allow.
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

function findConfig() {
  const candidates = [];
  if (process.env.CLAUDE_PROJECT_DIR) candidates.push(process.env.CLAUDE_PROJECT_DIR);
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    candidates.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
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
  return seg.split(/\s+/).filter(Boolean);
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
  config = findConfig();
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

  // Rule 3: git commit --no-verify / -n bypasses hooks and signing.
  const commitArgs = afterGitSub(seg, "commit");
  if (commitArgs && commitArgs.some((a) => a === "--no-verify" || a === "-n")) {
    block(`git commit --no-verify is forbidden unless the user explicitly requested it. If a hook fails, investigate and fix the underlying issue.`);
  }

  // Rule 4/5: pushes to protected branches (force = worse, but both blocked).
  const pushArgs = afterGitSub(seg, "push");
  if (pushArgs) {
    const forceFlag = pushArgs.some(
      (a) => a === "--force" || a === "-f" || a === "--force-with-lease" || a.startsWith("--force-with-lease="),
    );
    const nonFlag = pushArgs.filter((a) => !a.startsWith("-"));
    const refspecs = nonFlag.slice(1); // first non-flag is the remote
    const force = forceFlag || refspecs.some((r) => r.startsWith("+"));
    for (const rs of refspecs) {
      if (protectedSet.has(refspecDest(rs))) {
        if (force) {
          block(`git push --force to '${refspecDest(rs)}' is destructive on a shared branch and requires explicit user authorization.`);
        }
        block(`Direct push to '${refspecDest(rs)}' is forbidden. Integration happens via PR (base ${prBase}).`);
      }
    }
  }

  // Rule 6: gh pr merge without an explicit strategy drifts from the convention.
  const mergeArgs = afterGhPr(seg, "merge");
  if (mergeArgs && !mergeArgs.some((a) => a === "--squash" || a === "--merge" || a === "--rebase")) {
    process.stderr.write(`[${NAME}] WARN: gh pr merge without an explicit strategy. Convention is --squash --delete-branch. Continuing.\n`);
  }
}

process.exit(0);
