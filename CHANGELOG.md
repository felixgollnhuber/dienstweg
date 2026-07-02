# Changelog

## v0.1.0 (2026-07-02)

Initial release of the config-driven model.

- CLI: `init` (interactive interview, fresh + existing repos, non-interactive via `--yes` + flags), `update` (regeneration + config migrations + hand-edit protection), `check` (doctor).
- Generic English commands `/create-issue` and `/start-task` that read `dienstweg.config.json` at runtime; no per-project instantiation.
- Config-driven `branch-guard` PreToolUse hook (base branch, protected branches, `--no-verify`, force push) - fails open with a warning when the config is missing.
- AGENTS.md marker block (`<!-- dienstweg:begin/end -->`), `CLAUDE.md` generated as `@AGENTS.md` import when absent.
- Onboarding prompt for existing projects (semantic conflict audit by a coding agent), saved to `.dienstweg/onboarding-prompt.md`.
- Strict ownership contract: tool-owned files are hash-tracked in `.dienstweg/manifest.json`; customization only via config + `dienstweg.local.md`.
- Renamed from `agent-taskflow` to `dienstweg`; all content rewritten in English; session-rename choreography removed.
