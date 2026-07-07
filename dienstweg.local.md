# dienstweg.local.md - project-specific workflow rules

## Single-writer area map

The `areas.singleWriter` names in `dienstweg.config.json` cover these files:

- `branch-guard` - `templates/hooks/branch-guard.mjs`, its generated copies
  (`.claude/hooks/branch-guard.mjs`, `.codex/hooks/branch-guard.mjs`) and the
  guard tests (`tests/branch-guard.test.mjs`).
- `cli-core` - `src/*.mjs`, `bin/dienstweg.mjs`, `migrations/` and their tests.

Files outside both areas (docs, command/skill templates, `templates/agents-block.md`)
have no lock; an issue may be `parallel-safe` only if it touches no locked area at all.

Tie-break for cross-cutting issues (exactly one label per issue): if the change
alters branch-guard rule content or its rendered output, take
`single-writer:branch-guard`, otherwise `single-writer:cli-core` - and check the
other area's In Progress issues as an explicit dependency before starting.
