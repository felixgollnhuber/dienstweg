# dienstweg.local.md - project-specific workflow rules

This file is owned by the project and never overwritten by dienstweg. The
`/create-issue` and `/start-task` commands read it in addition to
`dienstweg.config.json`. Put everything here that the config schema cannot
express, for example:

- A worktree helper script that replaces plain `git worktree add` (and the
  setup command to run inside a fresh worktree, e.g. `npm ci`).
- A destructive demo-data/seed command and when it is needed.
- Additional review focus areas, domain-specific verification steps.
- Anything an agent must know before touching this repo's tasks.

Delete this explanatory text once you add real rules. An empty or missing
file is fine.
