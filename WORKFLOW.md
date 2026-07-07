# The dienstweg workflow

Generic task workflow for agent-assisted development with Claude Code or Codex, Linear and GitHub. Project values come from `dienstweg.config.json` (written by `dienstweg init`); the commands and the hook read that config at runtime. This document describes the workflow itself - the rules an agent follows in an adopting repo are rendered into the repo's AGENTS.md block and the two commands.

`dienstweg init` sets up **both harnesses by default** (`config.harnesses`, pick one with `--harness claude|codex`). Each gets its native, repo-committed command surface - Claude Code slash-commands under `.claude/commands/`, Codex skills under `.agents/skills/` - while the workflow rules live in the shared AGENTS.md block that both read natively, and the branch-guard git hook is wired for each (`.claude/settings.json` and `.codex/hooks.json`). The two harnesses differ only where their primitives do: the ensemble review fans out via review subagents in Claude Code and via parallel `codex exec` processes in Codex; `/goal` is a built-in in both. Everything else is identical.

## 1. Principles

1. **Issue = single source of truth.** Every task is a Linear issue (`<prefix>-XXX`) with a complete description (Plan, AC, DoD, Setup, Final Summary). No local backlog files, no task knowledge that only lives in a chat.
2. **Plan before code.** No implementation commit before the plan is in the issue and approved. Non-negotiable.
3. **Measurable gates instead of gut feeling.** Build/test commands with exit code 0, checked-off boxes, existing PRs - never conditions like "the code is clean".
4. **Redundant review.** N independent reviewers (default 3), run in parallel, with an identical, broad scope - review subagents in Claude Code, separate `codex exec` processes in Codex. The value is the ensemble: consensus = high priority, singletons = judge critically, conflicts = decide explicitly.
5. **Autonomous merge with hard gates.** After a clean review loop, merge without asking - but only when ALL gates are green. A user override ("do not merge automatically") holds for the whole session. Configurable per repo: `merge.auto` (default `true`); when `false`, the agent stops at `state="In Review"` and reports instead of merging (section 7).
6. **Machine-enforced rules.** Git conventions are not just documented; the branch-guard PreToolUse hook blocks violations.
7. **Scope discipline.** Never widen scope silently - ask the user or create a follow-up issue.

## 2. Issue schema

Every issue description follows this template (rendered with concrete values by the commands):

```markdown
## Plan
<set before code work, via /start-task>

## Acceptance Criteria
- [ ] AC #1

## Definition of Done
- [ ] <gates.build> exit 0
- [ ] Acceptance criteria fulfilled + checked off
- [ ] No unauthorized side effects (cronjobs/webhooks/destructive scripts)
- [ ] High-risk areas (<areas.highRisk>) verified
- [ ] No secrets in the code
- [ ] Single-writer lock checked (parallel-safe or lock-free at merge time)
- [ ] <review.ensembleSize>x ensemble review executed
- [ ] PR base = <git.baseBranch>
<+ one line per extraDoD entry>

## Setup
- Worktree: <set by /start-task>
- Single-writer lock: <parallel-safe | single-writer:<area>>

## Final Summary
<set before state=Done: merge SHA, PR number, review rounds, follow-up issues>
```

## 3. Git conventions

- Base branch for all PRs: `git.baseBranch`. Direct pushes to protected branches are blocked by the hook.
- Feature branches: `tasks/<prefix-lower>-XXX-<short-slug>`; commits `<PREFIX>-XXX - short description`; PR titles `<PREFIX>-XXX - task title` with an explicit `--base`.
- Merge: `gh pr merge <N> --squash --delete-branch`, then mandatory `git checkout <base> && git pull --ff-only` (otherwise the next `/start-task` branches off a stale base).
- Tooling/infra changes without an issue may use a `tasks/<short-slug>` branch without prefix.

## 4. Parallelism labels

Exactly one per issue: `parallel-safe` (touches no hot area) or `single-writer:<area>` (exclusive lock on one of `areas.singleWriter`). Before starting, check for other `In Progress` issues holding the same lock. When unsure, prefer `single-writer` over a wrong `parallel-safe`.

## 5. Task lifecycle

1. Claim: `save_issue state="In Progress" assignee="me"`.
2. Plan BEFORE code into the description (`## Plan`), structured via `/start-task`.
3. During work: check off AC boxes via description patches, add notes as comments, update the plan as needed.
4. Plan amendments vs. scope changes: when the approved plan is merely insufficient (a few extra touch points), amend it (see "Plan amendments" below); a genuine new goal or feature is a scope change - ask or create a follow-up issue, never silently.
5. Backlog discipline BEFORE the PR is merged: all AC + DoD boxes checked, `## Final Summary` with merge-SHA placeholder + PR number, `state="In Review"`. These are Linear description patches, not git commits - do them before the merge so the review gate sees a complete issue.
6. Ensemble review (section 6) including direct fixes and re-review rounds.
7. Auto-merge (section 7) including the post-merge sync step - or, with `merge.auto: false`, stop at `In Review` and hand the merge to the user.
8. Close out: `state="Done"` + finalize `## Final Summary` (real merge SHA, review rounds, follow-up issues).

**Plan amendments (mid-task re-planning).** The `## Plan` is not frozen once approved. When the `/goal` loop discovers it is insufficient - a helper, test, or doc file must also change that was not in the touch points - it does *not* silently widen scope. Instead it appends an `### Amendments` sub-section to the `## Plan` block via a `save_issue` description patch, one entry per amendment recording **reason**, **new touch points** (the files added to the plan), and a **LOC estimate**. The move is autonomous only when the amendment adds **≤2 new non-high-risk touch points** (a touch point is any file that must change but was not in the original plan, whether newly created or an existing file now edited); when it adds **>2** new touch points, or **any** high-risk area (`areas.highRisk`), the loop stops and asks the user first. Because a recorded amendment extends the plan, the `/goal` file-scope constraint reads "no files outside the *amended* plan's touch points" (§8) - so a properly-recorded amendment is not a violation, while touching unplanned files without amending still is. An amendment handles a plan that fell short; a genuine new goal or feature remains a scope change (§1.7) and still means ask or a follow-up issue.

## 6. Ensemble review (mandatory before every merge)

- Launch `review.ensembleSize` (default 3) reviewers in parallel: in Claude Code as review subagents **in one message** (use `review.subagentType` if the repo actually defines an agent of that name, e.g. `.claude/agents/ensemble-reviewer.md` — the config field alone doesn't create one; otherwise `general-purpose`); in Codex as `review.ensembleSize` independent `codex exec` processes started in one batch (prefer `codex exec --json`, run them read-only, apply fixes yourself afterwards).
- **No scope splitting** - every reviewer covers the full PR broadly (code quality, bugs, logic, conventions, tests, edge cases, error handling, security, high-risk areas, performance). Deliberately redundant.
- Each subagent gets PR number + branch + worktree path + an identical prompt; output: structured report (Critical / Important / Suggestions / Strengths) with `file:line` references.
- **Synthesis by the main agent**: consensus findings (>=2 reviewers) are fixed directly; singletons are judged critically (real issues get fixed too); conflicts are decided explicitly, never silently averaged.
- Fixes land as follow-up commits on the same branch; larger refactors become follow-up issues.
- **Re-review** (full ensemble again) when the fixes constitute a larger change - any of: new logic (function/class/route/migration), a high-risk area touched, >50 net LOC since the last review, >3 files not in the original diff, public interface changes. Cosmetics (typos, imports, formatting) do not trigger it. When in doubt: re-review. Max `review.maxRounds` rounds, then park the rest as a follow-up issue.
- Note each round in the Final Summary: "re-review round N (trigger: <reason>), findings: <count>".
- Reviewer hygiene: parallel reviewers in the same worktree can leave artifacts - check `git status` after the review and restore foreign files before making fix commits.
- "Merge-ready" without the ensemble (including required re-review rounds) or without applying directly fixable findings counts as unfinished work.

## 7. Auto-merge

Governed by `merge.auto` in the config (default `true`). With `merge.auto: false` the agent never merges autonomously: it completes everything up to and including `state="In Review"` (all DoD boxes checked, `## Final Summary` with merge-SHA placeholder + PR number), then reports the PR URL + gate status and stops. The merge is the user's move - done manually or by explicitly instructing the agent; in the latter case the gates below, the post-merge sync and the `state="Done"` close-out apply unchanged.

With `merge.auto: true`, after a clean review loop the agent merges autonomously: `gh pr merge <N> --squash --delete-branch`, reporting merge SHA + PR URL. Then, never skipped, in the MAIN working copy (not the task worktree - git refuses to check out a branch already checked out elsewhere, and `--delete-branch` may report "already used by worktree", which is not a merge failure):

```
git checkout <git.baseBranch> && git pull --ff-only
```

and confirm the new HEAD to the user before setting `state="Done"`.

Gates (all must hold, otherwise report instead of merging):

- PR base is `git.baseBranch`.
- `gates.build` exits 0 after the last fix commits (check the exit code directly, do not mask it with pipes).
- DoD gate: `get_issue` before the merge; any unchecked `- [ ]` box in `## Definition of Done` blocks the merge.
- No open majority critical findings from the last review round.
- Re-review loop finished (or max rounds reached with the rest parked as a follow-up issue).
- No user override active.

## 8. The /goal loop

`/start-task` ends with a ready-to-send `/goal` condition containing measurable end states: plan implemented, gates exit 0, AC boxes checked, PR created, ensemble review + synthesis done, DoD boxes + Final Summary + In Review set before the merge, auto-merge only with green gates, post-merge base sync confirmed, and `state="Done"` as the final step. With `merge.auto: false` the condition ends at `state="In Review"` plus a PR-URL/gate-status report instead of the merge and `state="Done"` steps. Constraints forbid `--no-verify`, hook bypasses, pushes to protected branches, force pushes, files outside the *amended* plan's touch points (the plan may be extended mid-task via the amendment protocol, §5), plus everything in `extraConstraints`. High-risk issues add smaller commits + intermediate verification; single-writer issues add the lock constraint. Bounded at 40 turns.

## 9. Versioning and updates

- dienstweg versions are semver git tags on this repo; `package.json` carries the version. Adopting repos stamp it as `dienstwegVersion` in their config.
- Tool-owned files (Claude commands + Codex skills, the per-harness branch-guard hook, the AGENTS block) are regenerated by `dienstweg update` - conflict-free because they are never hand-edited. `.dienstweg/manifest.json` stores content hashes for the active harnesses; `check` and `update` detect hand-edits (update skips them unless `--force`).
- Config schema changes ship as migrations (`migrations/index.mjs`, applied in ascending `toSchemaVersion` order during `update`). Schema v3 adds `harnesses`: an `update` of a pre-v3 repo gains the Codex surface automatically (default both).
- Project customization happens exclusively in `dienstweg.config.json` (`harnesses`, `extraDoD`, `extraConstraints`, `areas`, `gates`, `review`, `merge`) and `dienstweg.local.md`.

## 10. Adoption paths

- **Fresh repo**: `dienstweg init` -> create the Linear team (key = prefix) with labels `parallel-safe` + `single-writer:<area>` -> `dienstweg check` -> first `/create-issue`.
- **Existing project**: `dienstweg init` detects it, never overwrites colliding files, and emits the onboarding prompt (`.dienstweg/onboarding-prompt.md`). A coding agent then audits CLAUDE.md/AGENTS.md, CONTRIBUTING, CI workflows, PR templates and pre-existing hooks for contradictions, proposes per-finding resolutions (dienstweg wins / project wins via config / user decides), applies the agreed ones and verifies with `dienstweg check`.
