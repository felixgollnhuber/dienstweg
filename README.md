# dienstweg

Config-driven task workflow framework for agent-assisted development (Claude Code + Linear + GitHub). *Immer schoen den Dienstweg einhalten.*

One Linear issue is the single source of truth per task. Two slash commands structure the way in (`/create-issue`) and through (`/start-task` -> `/goal` loop), an ensemble review and hard auto-merge gates protect quality, and a PreToolUse hook guards the git rules. The hook is a guardrail against common accidental violations (wrong PR base, push to a protected branch, `--no-verify`, force push), not a security sandbox - deliberate obfuscation can bypass it, and that is fine.

The key design decision: **configuration instead of instantiation**. The commands and the hook are generic and read `dienstweg.config.json` at runtime. Generated files are tool-owned (never hand-edited), so `dienstweg update` is a conflict-free overwrite - workflow updates roll out to every adopting repo with one command.

## Install

Clone this repo and put `dienstweg` on your PATH once:

```
git clone <dienstweg repo> && cd dienstweg && npm link
```

(`npm link` makes the `dienstweg` command global with no dependencies to install. Alternatively run `node /path/to/dienstweg/bin/dienstweg.mjs` directly, or `npx github:<owner>/dienstweg` once it is pushed.)

## Adopt

From the target repo's root:

```
dienstweg init          # interactive interview
dienstweg init --yes    # non-interactive, defaults + flags
```

`init` asks: existing project or fresh repo, project name, conversation language (default en), Linear team/prefix, base branch, build gates, high-risk and single-writer areas. It writes:

- `dienstweg.config.json` - the single source of project values (the only file you edit)
- `.claude/commands/create-issue.md`, `.claude/commands/start-task.md` - generic commands (tool-owned)
- `.claude/hooks/branch-guard.mjs` + a merged hook entry in `.claude/settings.json`
- a marker block in `AGENTS.md` (`<!-- dienstweg:begin/end -->`) + `CLAUDE.md` as `@AGENTS.md` import if absent
- `dienstweg.local.md` - project-owned stub for rules the config cannot express
- `.dienstweg/manifest.json` - hashes of tool-owned files (hand-edit detection)

For **existing projects** (or when `init` had to skip a colliding file), it additionally emits a self-contained **onboarding prompt** (printed + saved to `.dienstweg/onboarding-prompt.md`, which is git-ignored automatically): paste it into Claude Code or Codex and the agent audits the repo for rules that contradict the workflow (CLAUDE.md, CONTRIBUTING, CI, hooks), proposes resolutions, and verifies the setup with `dienstweg check`.

Commit these files after init: `dienstweg.config.json`, `dienstweg.local.md`, `.claude/` (commands, hook, settings.json), and `.dienstweg/manifest.json`. If the hook and settings are not committed, a fresh clone has a silently inert guard; if the manifest is not committed, every teammate's `check` reports it missing.

## Update

```
dienstweg update           # regenerate tool-owned files, run config migrations
dienstweg update --force   # also overwrite hand-edited / unmanaged generated files
dienstweg check            # verify config, files, hook wiring, AGENTS block
```

Versioning: dienstweg versions are semver git tags on this repo; every adopting repo carries a `dienstwegVersion` stamp in its config. Config schema changes ship as migrations in `migrations/index.mjs` and run automatically during `update`.

## Contract

- Tool-owned files (commands, hook) and the AGENTS marker block are **never hand-edited**. Customization goes into `dienstweg.config.json` (`extraDoD`, `extraConstraints`, `areas`, `gates`) or `dienstweg.local.md`. `check` flags hand-edited files (via manifest hashes) and a hand-edited or stale AGENTS block (by re-rendering it from the config).
- The workflow itself is documented in [WORKFLOW.md](WORKFLOW.md).

## Requirements

Node >= 20, git, Claude Code v2.1.139+ (`/goal`), a Linear MCP server, `gh` CLI.

## Origin

Extracted and generalized from the [internal]/[internal] migration workflow (July 2026). Deliberately absent: session-rename choreography (removed).
