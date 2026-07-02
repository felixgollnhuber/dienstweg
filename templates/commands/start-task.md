---
description: Prepare a Linear issue for implementation - worktree + plan + ready-to-run /goal condition
argument-hint: <ISSUE-IDENTIFIER> (e.g. 123 or PREFIX-123)
---

You are preparing the Linear issue `$ARGUMENTS` for implementation. Goal: worktree + a comprehensive plan in the Linear issue description (section `## Plan`), so that `/goal` can afterwards work through it without further questions.

## Step 0 - Load the project config

- Read `dienstweg.config.json` at the repo root. All `config.*` references below come from this file. Key values: `config.tracker.issuePrefix`, `config.tracker.linearTeam`, `config.git.baseBranch`, `config.gates.build`, `config.areas.highRisk`, `config.areas.singleWriter`, `config.review.*`, `config.extraConstraints`.
- Read `dienstweg.local.md` if it exists - its rules apply in addition to this command.
- Respond to the user in `config.language`.
- Use the Linear MCP tools (`get_issue`, `save_issue`, `list_issues`, ... - the tool prefix depends on the installed Linear MCP server).

## Step 1 - Load the issue

- Normalize `$ARGUMENTS` to the format `<issuePrefix>-XXX` (e.g. `123` -> `FAC-123` when the prefix is FAC).
- Call `get_issue` with that identifier. Read: title, description (including the sections `## Plan`, `## Acceptance Criteria`, `## Definition of Done`, `## Setup`, `## Final Summary`), labels, project, milestone, relations, state.
- If the issue does not exist or is already `Done`: STOP, ask the user.
- Check the parallelism labels (`parallel-safe`, `single-writer:<area>`) and log them briefly.
- If the description is empty or missing the template: create the skeleton from the description template (see the dienstweg block in AGENTS.md), derive AC + DoD from the issue title, and present it to the user for approval before step 4.

## Step 2 - Ensure the worktree

- Branch name: `tasks/<issueprefix-lowercase>-XXX-<short-slug>` (slug from the issue title, max 4-5 words, kebab-case, lowercase).
- Worktree path: `.claude/worktrees/tasks+<issueprefix-lowercase>-XXX-<slug>` relative to the main repo.

First check via `git worktree list` whether a worktree for this issue already exists:

- **exists** and cwd points at it: skip creation, run the setup command if the project has one (idempotent), continue with step 3.
- **exists** and cwd points elsewhere: STOP, ask the user whether to use the existing worktree.
- **does not exist**: create it (below), then switch into it (cwd!).

Creation (plain git; if the project defines a worktree helper script in `dienstweg.local.md`, use that instead - it is the single source of truth for setup):

```
git worktree add .claude/worktrees/tasks+<prefix>-XXX-<slug> -b tasks/<prefix>-XXX-<slug> <config.git.baseBranch>
cd .claude/worktrees/tasks+<prefix>-XXX-<slug> && <project setup, e.g. npm ci - skip if not applicable>
```

## Step 3 - Destructive-setup decision (decide only, do NOT execute)

If the project defines a demo-data or seed command (in `dienstweg.local.md`): judge from the issue content + AC whether it is needed for manual verification. If needed, note it in the plan's Setup section as optional-before-manual-verification. **Never execute it in /start-task** - it is destructive and the user decides. If the project defines no such command, note `Demo data: not required` in the plan.

## Step 4 - Enter PlanMode and ask questions

- Call `EnterPlanMode`.
- In PlanMode, ask as many questions via `AskUserQuestion` as needed to resolve ambiguities. **Two extra questions beat one silent assumption.** Typical topics:
  - Scope boundaries: what belongs in this issue, what becomes a follow-up issue?
  - Which concrete files/components will be touched
  - Test strategy (unit / integration / manual)
  - Schema/format impact, rollback path
  - Dependencies on parallel issues (check first: `list_issues state="In Progress" label="single-writer:<area>"`)
- Only when all essential questions are resolved: continue with step 5.

## Step 5 - Write the comprehensive plan

The plan must be `/goal`-ready. It goes into the Linear issue description's `## Plan` block. Required sections:

```markdown
## Plan

### Setup
- Worktree: <path> on branch <branch>
- Demo data: <required | not required>

### Touch points (concrete files)
- <path/file-a> - <what changes>
- <path/file-b> - <what changes>

### Implementation steps (in order)
1. ...
2. ...

### Tests
- Unit: <which tests / where>
- Integration: <yes/no, which>
- Manual verification: <which flows>

### DoD gates
- <config.gates.build>
- <config.review.ensembleSize>x ensemble review before proposing the merge, directly fixable findings as follow-up commits

### Risks / rollback
- <risk 1> -> <mitigation>
- Rollback path: <...>

### PR
- Base: `<config.git.baseBranch>`
- Title: `<issuePrefix>-XXX - <issue title>`
- Commit prefix: `<issuePrefix>-XXX - <short>`
```

## Step 6 - Write the plan into the issue description, set the state

- `save_issue` with the full description body (updated `## Plan` block; keep existing `## Acceptance Criteria` and `## Definition of Done` content, only add/replace `## Plan`). Read with `get_issue` first, patch precisely, write back - the description API replaces the whole body.
- `save_issue state="In Progress" assignee="me"`.

## Step 7 - Compose the /goal condition

The `/goal` command (Claude Code v2.1.139+) is a session-scoped stop hook: after every turn a small model checks the transcript against the condition. The condition therefore needs **measurable, transcript-verifiable end states**. Compose it exactly after this schema (single line, max ~3500 chars, in `config.language`, ready to send - replace every `<...>` with the concrete values from the config and this issue):

```
/goal <issuePrefix>-XXX plan fully implemented: all implementation steps from the ## Plan block of the issue description done, <config.gates.build> exit 0, all acceptance criteria boxes in the ## Acceptance Criteria section toggled to `- [x]` via save_issue, PR created against <config.git.baseBranch> (title: "<issuePrefix>-XXX - <title>"), <config.review.ensembleSize>x ensemble review executed (<config.review.ensembleSize> parallel review subagents in ONE message, broad scope) with consensus synthesis and follow-up commits for consensus findings, re-review loop on larger changes (threshold: new logic / high-risk / >50 LOC / >3 new files / interface change, max <config.review.maxRounds> rounds), BEFORE `gh pr merge` all DoD boxes in the ## Definition of Done section toggled to `- [x]` via save_issue and the ## Final Summary section set with merge-SHA placeholder + PR number plus state="In Review", auto-merge via `gh pr merge <N> --squash --delete-branch` only if all gates are green (base=<config.git.baseBranch>, build exit 0, all DoD boxes checked, no open majority critical findings, re-review loop finished, no user override), MANDATORY step after a successful merge: run `git checkout <config.git.baseBranch> && git pull --ff-only` and confirm the new HEAD in a user message - this step must NOT be skipped, and AS THE LAST STEP BEFORE LOOP EXIT explicitly save_issue state="Done" plus a description patch with the real merge SHA in ## Final Summary (the loop must NOT stop earlier even if everything else looks finished). Constraints: no --no-verify, no hook bypass, no push to protected branches, no force push, <config.extraConstraints, comma-joined - omit if empty>, no files outside the plan's touch points. Stop after 40 turns if not fulfilled.
```

If the issue touches a **high-risk area** (`config.areas.highRisk`), add to the constraints: `smaller commits, intermediate verification after every destructive data operation`.

If a `single-writer:<area>` label is active, add: `no parallel edits to <area> hot files while another issue is In Progress`.

## Step 8 - ExitPlanMode

Present a compact overview via `ExitPlanMode`:

- Worktree path + branch
- Destructive-setup decision (one sentence, if applicable)
- Number of implementation steps
- Main risks (max 2 bullets)
- **The fully composed `/goal` command from step 7 in its own code block** (copy-paste ready)
- Note: "The plan is stored in the Linear issue (## Plan block of the description). After approval please send the `/goal` command."

## Step 9 - After plan approval (new turn)

As soon as the user approves the plan and the next turn begins: **do NOT start any implementation work yourself.** Instead reply with exactly this structure:

```
Plan approved. Please start the autonomous loop:

/goal <condition from step 7>

(Into the chat line, then Enter.)
```

Wait for the user's `/goal` command. Only when it arrives does implementation begin - and then **not through this slash command** but through the official `/goal` loop.

Rationale: `/goal` cannot technically be triggered from within a slash command. The `/goal` loop beats a DIY continue: per-turn completion check, automatic stop on the bounding clause, robust against intermediate errors, recoverable via `--resume`.

## Hard rules

- In steps 0-9: NO code changes, NO destructive setup runs, NO commit/push/PR. Implementation happens exclusively in the subsequent `/goal` loop.
- Destructive setup commands only after explicit user confirmation.
- With an active `single-writer:<area>` label: re-check for competing `In Progress` issues before step 7; on conflict ask the user.
- The goal condition must be **measurable in the transcript** - no conditions like "code is clean".
- All description patches via `save_issue` with the complete description body: `get_issue` first, patch precisely, write back.
- At most one active `/goal` per worktree.
