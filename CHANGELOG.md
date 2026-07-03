# Changelog

## v0.2.0 (2026-07-03)

Auto-merge becomes a config switch.

- New config key `merge.auto` (default `true` = previous behavior). With `false` the agent never merges autonomously: after a clean review loop it checks off the DoD boxes, writes the Final Summary (merge-SHA placeholder + PR number), sets `state="In Review"` and reports PR URL + gate status - the merge is the user's move, manually or by explicit instruction (gates, post-merge sync and `state="Done"` close-out still apply then). The AGENTS block and the `/goal` condition composed by `/start-task` both render/read the switch.
- `dienstweg init` asks "Auto-merge PRs when all gates are green?" (default yes); non-interactive via `--auto-merge` / `--no-auto-merge`.
- Config schema v2 with the first real migration: `dienstweg update` adds `merge.auto: true` to existing configs. `check` now hints at `dienstweg update` when the config schema is behind the CLI, and `validateConfig` rejects a non-boolean `merge.auto` (a string `"false"` would read as enabled).

## v0.1.3 (2026-07-02)

Re-review round 3 (final; 0 critical). Fixed the two remaining broken-recovery-path bugs; the rest were nitpicks and are parked.

- `update` no longer dead-ends on a corrupt `.dienstweg/manifest.json`. The manifest is disposable, regenerable state, so a parse failure is now treated as absent (regenerate from scratch) instead of throwing - which had contradicted `check`'s own "run `dienstweg update` to regenerate" advice.
- `update` (and `init`) now exit non-zero and print a WARN when a malformed `.claude/settings.json` prevented the branch-guard from being wired, instead of reporting a clean success with the "NOT wired" line buried in normal output (a CI wrapper would otherwise treat an inert guard as success). `mergeSettings` returns `{ wired, message }`.

Parked (guardrail-scope nitpicks, tracked for a future pass): equals-bundled push flags with a sole branch token (`git push --repo=origin main`); a `:dst` delete refspec reported with the generic "Direct push" message; partial-write ordering when AGENTS.md markers are corrupt (recoverable); cosmetic empty-config rendering of the Extra DoD line.

## v0.1.2 (2026-07-02)

Second hardening pass after re-review round 2 (0 critical; consensus + real completeness findings).

- `update` no longer dead-ends on a config that merely lost its `schemaVersion` stamp: a missing/zero stamp is treated as the initial schema and repaired, instead of throwing "this is a dienstweg bug". The genuine-missing-migration error is reserved for a real gap between migration versions.
- `mergeSettings` treats the branch-guard as already wired when it lives in `settings.local.json`, so `init`/`update` no longer append a duplicate entry to `settings.json` (which made the hook run twice).
- branch-guard: strips shell grouping so `(git push origin main)` and `(cd sub && git push origin main)` are caught; blocks protected-branch deletes/refspecs without an explicit remote (`git push :main`, `git push --delete main`, `git push -d main`); catches the bundled short form `git commit -nm`; and reports `--force-with-lease` accurately instead of calling it `--force`.
- `collectFindings` no longer throws on a non-array `hooks.PreToolUse` (reports the shape problem instead); value flags reject a following token that is itself a flag (`--name --yes` now errors instead of recording a garbage project name); `check` surfaces an INFO when a settings file is broken but the hook is wired via another; README drops the misleading `npx github:` hint for the currently-private package.

## v0.1.1 (2026-07-02)

Hardening release after a 3-reviewer ensemble review of v0.1.0.

- branch-guard rewritten: segment-based parsing instead of positional regex. Fixes accidental bypasses (`git push -u origin main` and any flag before the branch, `git commit -n`, refspec pushes `HEAD:main` / `+main` / `:main` / `refs/heads/main`, `git -C <dir> push`, quoted arguments like `"main"`) and false positives (`main-hotfix` and other branches sharing a protected prefix, force-push detection spanning `&&` into a legitimate `git checkout main`, `gh pr create --base=main` / `-B main` / quoted base, `--help`). Honestly documented as a guardrail, not a sandbox.
- `check` no longer crashes on the broken states it exists to diagnose (malformed config/manifest JSON, missing version stamp, manifest without `files`); each becomes a FAIL line. It now also detects a hand-edited or stale AGENTS block (by re-rendering from the config), corrupted/duplicate markers, and hook wiring in `settings.local.json`.
- `update` validates the config before regenerating (no more `undefined` rendered into artifacts), refuses a newer-than-supported schemaVersion, throws on a missing migration path instead of silently down-stamping, and leaves the version stamp untouched when files were skipped.
- `mergeSettings` tolerates a malformed-shape `hooks.PreToolUse` (not just invalid JSON) and no longer crashes init/update.
- `upsertAgentsBlock` refuses to append into a file with corrupted markers instead of duplicating or deleting content.
- init emits the onboarding prompt whenever files were skipped (not only for detected existing projects), git-ignores the prompt, prints which files to commit, and validates answers.
- Per-command flag allowlists; `issuePrefix` validated against the Linear key format; CRLF-tolerant frontmatter detection; `compareSemver` ignores prerelease/build suffixes; `dienstweg.local.md` no longer resurrected by `update`.
- Docs: removed the file-based-backlog leftover ("as the last commit on the branch"); clarified the post-merge base sync happens in the main working copy, not the task worktree; the issue-description template now lives canonically in the AGENTS block; `npm link` install path; softened the enforcement claims to match reality.

## v0.1.0 (2026-07-02)

Initial release of the config-driven model.

- CLI: `init` (interactive interview, fresh + existing repos, non-interactive via `--yes` + flags), `update` (regeneration + config migrations + hand-edit protection), `check` (doctor).
- Generic English commands `/create-issue` and `/start-task` that read `dienstweg.config.json` at runtime; no per-project instantiation.
- Config-driven `branch-guard` PreToolUse hook (base branch, protected branches, `--no-verify`, force push) - fails open with a warning when the config is missing.
- AGENTS.md marker block (`<!-- dienstweg:begin/end -->`), `CLAUDE.md` generated as `@AGENTS.md` import when absent.
- Onboarding prompt for existing projects (semantic conflict audit by a coding agent), saved to `.dienstweg/onboarding-prompt.md`.
- Strict ownership contract: tool-owned files are hash-tracked in `.dienstweg/manifest.json`; customization only via config + `dienstweg.local.md`.
- Renamed from `agent-taskflow` to `dienstweg`; all content rewritten in English; session-rename choreography removed.
