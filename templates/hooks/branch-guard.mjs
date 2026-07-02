#!/usr/bin/env node
// branch-guard hook: enforces the project's git rules machine-side.
// Reads the PreToolUse payload from stdin, emits feedback to stderr and exits
// with code 2 to BLOCK dangerous operations. Exit 0 = allow.
//
// Rules come from dienstweg.config.json at runtime (git.baseBranch,
// git.protectedBranches). If the config cannot be found or parsed, the hook
// warns and allows - a broken config must not lock up unrelated work; run
// `npx dienstweg check` to surface it.

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
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf8"));
    }
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

// Remove shell-quoted segments, command substitutions and heredocs so that
// trigger strings appearing only inside argv (e.g. a commit message that
// mentions "--no-verify") do not match the rule patterns. Not a full shell
// parser - good enough for typical CLI usage.
function stripInertSegments(s) {
  let out = s;
  let prev;
  do {
    prev = out;
    out = out.replace(/\$\([^()]*\)/g, " ");
  } while (out !== prev);
  out = out.replace(/`[^`]*`/g, " ");
  out = out.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\b\1\b/g, " ");
  out = out.replace(/"[^"]*"/g, " ");
  out = out.replace(/'[^']*'/g, " ");
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  process.stderr.write(`[${NAME}] WARN: dienstweg.config.json not found/invalid - allowing. Run \`npx dienstweg check\`.\n`);
  process.exit(0);
}

const prBase = config.git.baseBranch;
const protectedBranches = (config.git.protectedBranches?.length ? config.git.protectedBranches : [prBase]).map(escapeRegExp);
const protectedAlt = protectedBranches.join("|");

const normalized = command.replace(/\s+/g, " ").trim();
const inspectable = stripInertSegments(normalized).replace(/\s+/g, " ").trim();

// Rule 1: PRs must target the configured base branch.
const prCreateMatch = inspectable.match(/\bgh\s+pr\s+create\b[\s\S]*?--base\s+(\S+)/);
if (prCreateMatch) {
  const base = prCreateMatch[1].replace(/^["']|["']$/g, "");
  if (base !== prBase) {
    block(`gh pr create --base ${base} is forbidden. PRs must target '${prBase}'. See the dienstweg block in AGENTS.md.`);
  }
}

// Rule 2: gh pr create without an explicit --base is risky (the default base may be wrong).
if (/\bgh\s+pr\s+create\b/.test(inspectable) && !/--base\s+/.test(inspectable)) {
  block(`gh pr create without --base is forbidden. Pass --base ${prBase} explicitly.`);
}

// Rule 3: --no-verify bypasses hooks and signing.
if (/\bgit\s+commit\b[\s\S]*?--no-verify\b/.test(inspectable)) {
  block(`git commit --no-verify is forbidden unless the user explicitly requested it. If a hook fails, investigate and fix the underlying issue.`);
}

// Rule 4: force push to protected branches is destructive.
const forcePushMatch = inspectable.match(
  new RegExp(`\\bgit\\s+push\\b[\\s\\S]*?(?:--force\\b|--force-with-lease\\b|\\s-f\\b)[\\s\\S]*?\\b(${protectedAlt})\\b`),
);
if (forcePushMatch) {
  block(`git push --force to '${forcePushMatch[1]}' is destructive on a shared branch and requires explicit user authorization.`);
}

// Rule 5: direct push to protected branches - integration happens via PR.
const directPushMatch = inspectable.match(new RegExp(`\\bgit\\s+push\\s+\\S+\\s+(${protectedAlt})\\b`));
if (directPushMatch && !/HEAD:/.test(inspectable)) {
  block(`Direct push to '${directPushMatch[1]}' is forbidden. Integration happens via PR (base ${prBase}).`);
}

// Rule 6: gh pr merge without an explicit strategy drifts from the convention.
if (/\bgh\s+pr\s+merge\b/.test(inspectable) && !/(--squash|--merge|--rebase)\b/.test(inspectable)) {
  process.stderr.write(`[${NAME}] WARN: gh pr merge without an explicit strategy. Convention is --squash --delete-branch. Continuing.\n`);
}

process.exit(0);
