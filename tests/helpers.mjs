// Shared test helpers: repo root paths, temp dirs, and a CLI runner. Not a test
// file itself (no `.test.` in the name), so `node --test` skips it.
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BIN = join(ROOT, "bin", "dienstweg.mjs");
export const GUARD_TEMPLATE = join(ROOT, "templates", "hooks", "branch-guard.mjs");

const tempDirs = [];

// Creates a throwaway directory under the OS temp dir. Registered for cleanup.
export function tmp(prefix = "dienstweg-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// A throwaway dir that looks like a git repo root (an empty .git marker is
// enough to satisfy dienstweg's "am I at the repo root?" check).
export function tmpRepo() {
  const dir = tmp();
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

export function cleanupAll() {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

// Runs the dienstweg CLI in `cwd` and returns { status, stdout, stderr }.
export function runCli(args, cwd) {
  const r = spawnSync("node", [BIN, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Runs the branch-guard hook template with a piped stdin payload. `via` selects
// the config-discovery path: "claude" via the CLAUDE_PROJECT_DIR env var,
// "codex" via the payload `cwd` (no env var). The spawn cwd is a neutral empty
// dir so only the intended mechanism can locate the config.
export function runGuard(command, projectDir, via = "claude") {
  const neutral = tmp("dienstweg-neutral-");
  const payload = { tool_input: { command } };
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (via === "claude") {
    env.CLAUDE_PROJECT_DIR = projectDir;
  } else {
    payload.cwd = projectDir;
  }
  const r = spawnSync("node", [GUARD_TEMPLATE], {
    cwd: neutral,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr || "" };
}
