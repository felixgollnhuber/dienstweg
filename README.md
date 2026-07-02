# dienstweg

Config-driven task workflow framework for agent-assisted development (Claude Code + Linear + GitHub). *Immer schoen den Dienstweg einhalten.*

One Linear issue is the single source of truth per task. Two slash commands structure the way in (`/create-issue`) and through (`/start-task` -> `/goal` loop), an ensemble review and hard auto-merge gates protect quality, and a PreToolUse hook enforces the git rules machine-side.

The key design decision: **configuration instead of instantiation**. The commands and the hook are generic and read `dienstweg.config.json` at runtime. Generated files are tool-owned (never hand-edited), so `dienstweg update` is a conflict-free overwrite - workflow updates roll out to every adopting repo with one command.

## Install / adopt

From the target repo's root:

```
npx /path/to/dienstweg init          # interactive interview
npx /path/to/dienstweg init --yes    # non-interactive, defaults + flags
```

`init` asks: existing project or fresh repo, project name, conversation language (default en), Linear team/prefix, base branch, build gates, high-risk and single-writer areas. It writes:

- `dienstweg.config.json` - the single source of project values (the only file you edit)
- `.claude/commands/create-issue.md`, `.claude/commands/start-task.md` - generic commands (tool-owned)
- `.claude/hooks/branch-guard.mjs` + a merged hook entry in `.claude/settings.json`
- a marker block in `AGENTS.md` (`<!-- dienstweg:begin/end -->`) + `CLAUDE.md` as `@AGENTS.md` import if absent
- `dienstweg.local.md` - project-owned stub for rules the config cannot express
- `.dienstweg/manifest.json` - hashes of tool-owned files (hand-edit detection)

For **existing projects**, `init` additionally emits a self-contained **onboarding prompt** (printed + saved to `.dienstweg/onboarding-prompt.md`): paste it into Claude Code or Codex and the agent audits the repo for rules that contradict the workflow (CLAUDE.md, CONTRIBUTING, CI, hooks), proposes resolutions, and verifies the setup with `dienstweg check`.

## Update

```
npx /path/to/dienstweg update           # regenerate tool-owned files, run config migrations
npx /path/to/dienstweg update --force   # also overwrite hand-edited generated files
npx /path/to/dienstweg check            # verify config, files, hook wiring, AGENTS block
```

Versioning: dienstweg versions are semver git tags on this repo; every adopting repo carries a `dienstwegVersion` stamp in its config. Config schema changes ship as migrations in `migrations/index.mjs` and run automatically during `update`.

## Contract

- Tool-owned files (commands, hook, AGENTS block) are **never hand-edited**. Customization goes into `dienstweg.config.json` (`extraDoD`, `extraConstraints`, `areas`, `gates`) or `dienstweg.local.md`. `check` flags violations.
- The workflow itself is documented in [WORKFLOW.md](WORKFLOW.md).

## Requirements

Node >= 20, git, Claude Code v2.1.139+ (`/goal`), a Linear MCP server, `gh` CLI.

## Origin

Extracted and generalized from the PeakShare/Colibrie migration workflow (July 2026). Deliberately absent: session-rename choreography (removed).
