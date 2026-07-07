import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./config.mjs";

// The guard log: the branch-guard hook (templates/hooks/branch-guard.mjs)
// appends one JSON line per block/warn/fail-open decision to this file. It is a
// per-machine debug + observability artifact, never committed - init/update
// gitignore it via ensureGitignored(root, [GUARD_LOG_GITIGNORE_ENTRY]).
//
// The hook is a standalone rendered script that cannot import from src, so it
// hardcodes the same relative path (".dienstweg/guard-log.jsonl"). Keep the two
// in sync: this module is the single source of truth on the CLI side.
export const GUARD_LOG_FILENAME = "guard-log.jsonl";
export const GUARD_LOG_GITIGNORE_ENTRY = `${STATE_DIR}/${GUARD_LOG_FILENAME}`;

// How far back `check` looks when summarizing the log. Bounds the fail-open FAIL
// so it self-heals once old events age out, and keeps the read cheap on a log
// that only ever grows.
export const GUARD_LOG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function guardLogPath(root) {
  return join(root, STATE_DIR, GUARD_LOG_FILENAME);
}

// Reads the guard log and returns the parsed entries inside the recency window.
// Defensive by contract: the log is an append-only file written by a hook that
// may be killed mid-write, hand-edited, or absent - a missing file, an unreadable
// file, or a malformed line must never throw here (check must diagnose, never
// crash). `now` is injectable so tests can pin the window without touching the
// clock.
export function readGuardLog(root, now = Date.now(), windowMs = GUARD_LOG_WINDOW_MS) {
  const p = guardLogPath(root);
  if (!existsSync(p)) return [];
  let raw;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    return [];
  }
  const cutoff = now - windowMs;
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // a partial or corrupt line is skipped, not fatal
    }
    if (!entry || typeof entry !== "object") continue;
    // A missing or unparseable timestamp is treated as out-of-window (dropped)
    // rather than crashing the reader.
    const t = Date.parse(entry.ts);
    if (Number.isNaN(t) || t < cutoff) continue;
    entries.push(entry);
  }
  return entries;
}

// Turns recent guard-log entries into check diagnostics:
// - recent blocks are summarized per rule as a single INFO line;
// - recent fail-open events (the guard fell open because the config was
//   unreadable at hook runtime, so a violation may have slipped through) are a
//   FAIL - an inert guard must be loud, not silent.
// Returns { infos, problems } so the caller can splice them into check's own
// arrays without a shape change. `now` is injectable for tests.
export function guardLogDiagnostics(root, now = Date.now()) {
  const infos = [];
  const problems = [];
  const entries = readGuardLog(root, now);
  if (entries.length === 0) return { infos, problems };

  const blocks = entries.filter((e) => e.decision === "block");
  const failOpen = entries.filter((e) => e.decision === "fail-open");

  if (blocks.length > 0) {
    const perRule = new Map();
    for (const e of blocks) {
      const rule = typeof e.rule === "string" && e.rule ? e.rule : "unknown";
      perRule.set(rule, (perRule.get(rule) || 0) + 1);
    }
    const summary = [...perRule.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([rule, n]) => `${rule} (${n})`)
      .join(", ");
    infos.push(`branch-guard: ${blocks.length} recent block(s) in the last 7d - ${summary}.`);
  }

  if (failOpen.length > 0) {
    problems.push(
      `branch-guard fell open ${failOpen.length} time(s) in the last 7d (config unreadable at hook runtime) - the guard was inert and a git-rule violation may have slipped through. Fix dienstweg.config.json (see \`dienstweg check\` above), then clear ${GUARD_LOG_GITIGNORE_ENTRY} once resolved.`,
    );
  }

  return { infos, problems };
}
