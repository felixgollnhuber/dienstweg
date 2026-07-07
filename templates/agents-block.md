## Task workflow (dienstweg v{{version}})

This project follows the dienstweg task workflow. Project values live in `dienstweg.config.json`, project-specific additions in `dienstweg.local.md` (read both before task work). Respond to the user in "{{language}}". Tasks are tracked in Linear (team `{{linearTeam}}`, prefix `{{issuePrefix}}-XXX`); all issue operations go through the Linear MCP tools, never via REST or local files.

**Harnesses:** {{harnesses}}. The two commands below and the branch-guard git hook are installed for each active harness; the guard is active in whichever harness runs.

**Commands** (Claude Code: the `/create-issue` and `/start-task` slash-commands; Codex: the `create-issue` and `start-task` skills - invoke via `/skills`, `$name`, or by describing the intent):

- **create-issue** `<topic>` - create a new issue following the schema (interference check + collaborative plan drafting). Creates ONLY the backlog issue.
- **start-task** `{{issuePrefix}}-XXX` - worktree + plan in the issue description + ready-to-run `/goal` condition. Implementation happens only in the `/goal` loop.

**Git conventions:**

- Base branch: `{{baseBranch}}`. Feature branches: `tasks/{{issuePrefixLower}}-XXX-<slug>`.
- Commit: `{{issuePrefix}}-XXX - short description`. PR title: `{{issuePrefix}}-XXX - task title`, base always `{{baseBranch}}` (explicit). Tooling changes without an issue: `tasks/<short-slug>` branch without prefix.
- No `--no-verify`, no force push to shared branches, no direct push to protected branches (the branch-guard hook blocks common cases of these).
- Merge: `gh pr merge <N> --squash --delete-branch`, then MANDATORY: in the MAIN working copy (not the task worktree - git refuses to check out a branch already checked out elsewhere), run `git checkout {{baseBranch}} && git pull --ff-only` and confirm the new HEAD. A "branch is already used by worktree" message on `--delete-branch` is not a merge failure; the remote merge succeeded - remove the worktree and pull in the main copy.

**Issue discipline (all state lives in Linear, not in git):**

1. Claim: `save_issue state="In Progress" assignee="me"` - do this first, before planning, to close the single-writer race window.
2. Plan BEFORE code in the description (section `## Plan`). Non-negotiable.
3. Check off AC boxes via description patches, add notes as comments, never widen scope silently - amend the plan (see **Plan amendments** below) when it merely fell short, or ask / create a follow-up issue for a genuine new goal.
4. Before merging the PR: check off all AC + DoD boxes, write `## Final Summary` (merge-SHA placeholder + PR number), set `state="In Review"`. These are Linear description patches, not git commits.
5. After merge: `state="Done"` + Final Summary with the real merge SHA.

**Plan amendments (mid-task re-planning):** when the approved `## Plan` proves insufficient, do not silently widen scope - amend it. Append an `### Amendments` sub-section to `## Plan` via `save_issue` (description patch), each entry recording: reason, new touch points, LOC estimate. Autonomous threshold: amend and keep going on your own only while the amendments add <=2 new non-high-risk touch points in total (a touch point is any file that must change but was not in the original plan, whether newly created or an existing file now edited); once they add more than 2 new non-high-risk touch points, or any high-risk area ({{highRisk}}) is added, stop and ask first. The `/goal` file-scope constraint reads "no files outside the amended plan's touch points", so a recorded amendment is not a violation. This is distinct from a genuine scope change (a new goal or feature), which still means ask or a follow-up issue.

**Parallelism:** exactly one label per issue: `parallel-safe` or `single-writer:<area>` (areas: {{singleWriter}}). Before starting, check whether another issue holds the same lock.

**Review (mandatory before every merge):** {{ensembleSize}}x ensemble review - {{ensembleSize}} independent reviewers with an identical, broad scope, run in parallel, no splitting. The fan-out mechanism is harness-specific (Claude Code: parallel review subagents in one message; Codex: parallel `codex exec` reviewers) - see the start-task command. Fix consensus findings directly, judge singletons critically, decide conflicts explicitly. Re-review on larger fix changes (new logic / high-risk / >50 LOC / >3 new files / interface change), max {{maxRounds}} rounds. A single review pass does not replace the ensemble.

{{mergePolicy}}

**High-risk areas** ({{highRisk}}): smaller commits, intermediate verification after destructive operations, call them out separately in reviews.

**Extra DoD items (from config):**{{extraDoD}}

**Extra /goal constraints (from config):** {{extraConstraints}}

**Issue description template** (every issue follows this; `/create-issue` fills it, `/start-task` completes `## Plan`):

```markdown
## Plan
<set before code work, via /start-task>

## Acceptance Criteria
- [ ] AC #1

## Definition of Done
- [ ] {{buildGates}} exit 0
- [ ] Acceptance criteria fulfilled + checked off
- [ ] No unauthorized side effects (cronjobs/webhooks/destructive scripts)
- [ ] High-risk areas ({{highRisk}}) verified
- [ ] No secrets in the code
- [ ] Single-writer lock checked (parallel-safe or lock-free at merge time)
- [ ] {{ensembleSize}}x ensemble review executed
- [ ] PR base = {{baseBranch}}

## Setup
- Worktree: <set by /start-task>
- Single-writer lock: <parallel-safe | single-writer:area>

## Final Summary
<set before state=Done: merge SHA, PR number, review rounds, follow-up issues>
```
