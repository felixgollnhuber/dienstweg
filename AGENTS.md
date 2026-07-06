# AGENTS.md

<!-- dienstweg:begin -->
## Task workflow (dienstweg v0.3.1)

This project follows the dienstweg task workflow. Project values live in `dienstweg.config.json`, project-specific additions in `dienstweg.local.md` (read both before task work). Respond to the user in "en". Tasks are tracked in Linear (team `dienstweg`, prefix `DIE-XXX`); all issue operations go through the Linear MCP tools, never via REST or local files.

**Harnesses:** Claude Code + Codex. The two commands below and the branch-guard git hook are installed for each active harness; the guard is active in whichever harness runs.

**Commands** (Claude Code: the `/create-issue` and `/start-task` slash-commands; Codex: the `create-issue` and `start-task` skills - invoke via `/skills`, `$name`, or by describing the intent):

- **create-issue** `<topic>` - create a new issue following the schema (interference check + collaborative plan drafting). Creates ONLY the backlog issue.
- **start-task** `DIE-XXX` - worktree + plan in the issue description + ready-to-run `/goal` condition. Implementation happens only in the `/goal` loop.

**Git conventions:**

- Base branch: `main`. Feature branches: `tasks/die-XXX-<slug>`.
- Commit: `DIE-XXX - short description`. PR title: `DIE-XXX - task title`, base always `main` (explicit). Tooling changes without an issue: `tasks/<short-slug>` branch without prefix.
- No `--no-verify`, no force push to shared branches, no direct push to protected branches (the branch-guard hook blocks common cases of these).
- Merge: `gh pr merge <N> --squash --delete-branch`, then MANDATORY: in the MAIN working copy (not the task worktree - git refuses to check out a branch already checked out elsewhere), run `git checkout main && git pull --ff-only` and confirm the new HEAD. A "branch is already used by worktree" message on `--delete-branch` is not a merge failure; the remote merge succeeded - remove the worktree and pull in the main copy.

**Issue discipline (all state lives in Linear, not in git):**

1. Claim: `save_issue state="In Progress" assignee="me"` - do this first, before planning, to close the single-writer race window.
2. Plan BEFORE code in the description (section `## Plan`). Non-negotiable.
3. Check off AC boxes via description patches, add notes as comments, never widen scope silently - ask or create a follow-up issue.
4. Before merging the PR: check off all AC + DoD boxes, write `## Final Summary` (merge-SHA placeholder + PR number), set `state="In Review"`. These are Linear description patches, not git commits.
5. After merge: `state="Done"` + Final Summary with the real merge SHA.

**Parallelism:** exactly one label per issue: `parallel-safe` or `single-writer:<area>` (areas: -). Before starting, check whether another issue holds the same lock.

**Review (mandatory before every merge):** 3x ensemble review - 3 independent reviewers with an identical, broad scope, run in parallel, no splitting. The fan-out mechanism is harness-specific (Claude Code: parallel review subagents in one message; Codex: parallel `codex exec` reviewers) - see the start-task command. Fix consensus findings directly, judge singletons critically, decide conflicts explicitly. Re-review on larger fix changes (new logic / high-risk / >50 LOC / >3 new files / interface change), max 3 rounds. A single review pass does not replace the ensemble.

**Auto-merge (on, `merge.auto: true`):** after a clean review loop, merge autonomously - no asking. Gates (all mandatory): PR base = `main`, `npm test` exit 0 after the last fix commits, no open DoD boxes (check via `get_issue` before merging), no open majority critical findings, re-review loop finished, no user override ("do not merge automatically" holds for the whole session). Gate violated -> do not merge, report status.

**High-risk areas** (templates/hooks/branch-guard.mjs): smaller commits, intermediate verification after destructive operations, call them out separately in reviews.

**Extra DoD items (from config):**

**Extra /goal constraints (from config):** -

**Issue description template** (every issue follows this; `/create-issue` fills it, `/start-task` completes `## Plan`):

```markdown
## Plan
<set before code work, via /start-task>

## Acceptance Criteria
- [ ] AC #1

## Definition of Done
- [ ] npm test exit 0
- [ ] Acceptance criteria fulfilled + checked off
- [ ] No unauthorized side effects (cronjobs/webhooks/destructive scripts)
- [ ] High-risk areas (templates/hooks/branch-guard.mjs) verified
- [ ] No secrets in the code
- [ ] Single-writer lock checked (parallel-safe or lock-free at merge time)
- [ ] 3x ensemble review executed
- [ ] PR base = main

## Setup
- Worktree: <set by /start-task>
- Single-writer lock: <parallel-safe | single-writer:area>

## Final Summary
<set before state=Done: merge SHA, PR number, review rounds, follow-up issues>
```
<!-- dienstweg:end -->
