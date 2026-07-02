#!/usr/bin/env node
// branch-guard hook: enforces the project's git rules from AGENTS.md machine-side.
// Reads PreToolUse payload from stdin, emits feedback to stderr and exits with code 2
// to BLOCK dangerous operations. Exit 0 = allow.
//
// Invoked from .claude/settings.json on PreToolUse matcher "Bash".
// Generalized from the [internal] migration-guard (2026-07). Adjust CONFIG per project.

import { readFileSync } from "node:fs";

const CONFIG = {
  // The only branch PRs may target. Set to null to skip PR-base enforcement.
  prBase: "{{BASE_BRANCH}}",
  // Branches that must never receive direct or force pushes.
  protectedBranches: ["{{BASE_BRANCH}}"],
  // Require an explicit --base on gh pr create (defaults can silently target the wrong branch).
  requireExplicitBase: true,
  // Block git commit --no-verify.
  blockNoVerify: true,
  // Warn (not block) when gh pr merge lacks an explicit strategy.
  mergeStrategyHint: "--squash --delete-branch",
  name: "branch-guard",
};

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function block(reason) {
  process.stderr.write(`[${CONFIG.name}] BLOCKED: ${reason}\n`);
  process.exit(2);
}

// Remove shell-quoted segments, command substitutions, and heredocs so that
// trigger strings appearing only inside argv (e.g. a commit message that mentions
// "--no-verify") do not match the rule patterns. Not a full shell parser.
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

const normalized = command.replace(/\s+/g, " ").trim();
const inspectable = stripInertSegments(normalized).replace(/\s+/g, " ").trim();

const protectedAlt = CONFIG.protectedBranches.join("|");

// Rule 1: PRs must target CONFIG.prBase.
if (CONFIG.prBase) {
  const prCreateMatch = inspectable.match(/\bgh\s+pr\s+create\b[\s\S]*?--base\s+(\S+)/);
  if (prCreateMatch) {
    const base = prCreateMatch[1].replace(/^["']|["']$/g, "");
    if (base !== CONFIG.prBase) {
      block(
        `gh pr create --base ${base} is forbidden. PRs must target '${CONFIG.prBase}'. See AGENTS.md Git-Konventionen.`,
      );
    }
  }

  // Rule 2: gh pr create without explicit --base is risky (default base may be wrong).
  if (
    CONFIG.requireExplicitBase &&
    /\bgh\s+pr\s+create\b/.test(inspectable) &&
    !/--base\s+/.test(inspectable)
  ) {
    block(
      `gh pr create without --base is forbidden. Pass --base ${CONFIG.prBase} explicitly. See AGENTS.md Git-Konventionen.`,
    );
  }
}

// Rule 3: --no-verify bypasses hooks and signing.
if (CONFIG.blockNoVerify && /\bgit\s+commit\b[\s\S]*?--no-verify\b/.test(inspectable)) {
  block(
    `git commit --no-verify is forbidden unless the user explicitly requested it. ` +
      `If a hook fails, investigate and fix the underlying issue.`,
  );
}

// Rule 4: force push to protected branches is destructive.
const forcePushMatch = inspectable.match(
  new RegExp(
    `\\bgit\\s+push\\b[\\s\\S]*?(?:--force\\b|--force-with-lease\\b|\\s-f\\b)[\\s\\S]*?\\b(${protectedAlt})\\b`,
  ),
);
if (forcePushMatch) {
  block(
    `git push --force to '${forcePushMatch[1]}' is destructive on a shared branch and requires explicit user authorization.`,
  );
}

// Rule 5: direct push to protected branches (integration happens via PR).
const directPushMatch = inspectable.match(
  new RegExp(`\\bgit\\s+push\\s+\\S+\\s+(${protectedAlt})\\b`),
);
if (directPushMatch && !/HEAD:/.test(inspectable)) {
  block(
    `Direct push to '${directPushMatch[1]}' is forbidden. Integration happens via PR (base ${CONFIG.prBase ?? directPushMatch[1]}).`,
  );
}

// Rule 6: gh pr merge without an explicit strategy drifts from project convention.
if (
  /\bgh\s+pr\s+merge\b/.test(inspectable) &&
  !/(--squash|--merge|--rebase)\b/.test(inspectable)
) {
  process.stderr.write(
    `[${CONFIG.name}] WARN: gh pr merge without an explicit strategy. Convention is ${CONFIG.mergeStrategyHint}. Continuing.\n`,
  );
}

process.exit(0);
