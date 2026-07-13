---
description: Prepare a Linear issue for implementation - worktree + plan + ready-to-run /goal condition
argument-hint: <ISSUE-IDENTIFIER> [--codex|--no-codex] (e.g. 123 or PREFIX-123)
---

You are preparing the Linear issue `$ARGUMENTS` for implementation. Goal: worktree + a comprehensive plan in the Linear issue description (section `## Plan`), so that `/goal` can afterwards work through it without further questions.

## Step 0 - Load the project config

- Read `dienstweg.config.json` at the repo root. All `config.*` references below come from this file. Key values: `config.tracker.issuePrefix`, `config.tracker.linearTeam`, `config.git.baseBranch`, `config.gates.build`, `config.areas.highRisk`, `config.areas.singleWriter`, `config.review.*`, `config.merge.auto`, `config.extraConstraints`.
- Read `dienstweg.local.md` if it exists - its rules apply in addition to this command.
- Respond to the user in `config.language`.
- Use the Linear MCP tools (`get_issue`, `save_issue`, `list_issues`, ... - the tool prefix depends on the installed Linear MCP server).
- **Codex delegation mode detection:** the mode is ON when `$ARGUMENTS` contains the `--codex` flag OR the optional config key `config.delegation.implementer` equals `"codex"`. A flag wins over the config: `--codex` forces the mode ON, `--no-codex` forces it OFF for this run even when the config sets the default. The config key only sets the default and may be absent entirely. Strip both flags from `$ARGUMENTS` before normalizing the issue identifier. When the mode is OFF, this command behaves exactly as before - skip every "codex mode" block below.

## Step 0a - Codex preflight (codex mode only)

Skip this step entirely when codex mode is OFF. It runs BEFORE the issue is loaded or claimed - a failed preflight must not leave the issue stranded In Progress. Verify the openai-codex plugin is ready (read-only check, no repo or Linear mutation):

1. Resolve the companion script via glob: `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs`. If several versions match, take the highest semver (numeric compare - plain lexicographic sorting would put 1.0.9 above 1.0.10). Never hardcode a version - the plugin cache path is versioned.
2. Run `node <companion> setup --json` and parse the JSON output.
3. `ready: true` -> log the resolved companion path and continue (the /goal condition in step 6 references this companion; re-resolve the glob at use time if the remembered path has vanished, e.g. after a plugin update mid-task).
4. Anything else (no glob match, non-zero exit, `ready: false`) -> STOP: report what failed and point the user to `/codex:setup`. Do not silently fall back to normal mode - the user explicitly asked for delegation.

## Step 1 - Load the issue

- Normalize `$ARGUMENTS` to the format `<issuePrefix>-XXX` (e.g. `123` -> `ABC-123` when the prefix is ABC).
- Call `get_issue` with that identifier. Read: title, description (including the sections `## Plan`, `## Acceptance Criteria`, `## Definition of Done`, `## Setup`, `## Final Summary`), labels, project, milestone, relations, state.
- If the issue does not exist or is already `Done`: STOP, ask the user.
- Check the parallelism labels (`parallel-safe`, `single-writer:<area>`) and log them briefly.
- If the description is empty or missing the template: create the skeleton from the issue description template (in the dienstweg block in AGENTS.md), derive AC + DoD from the issue title, and present it to the user for approval before step 5.
- **Claim now** (before planning, to close the single-writer race window): `save_issue state="In Progress" assignee="me"`. This is a plain mutation done before plan mode, not inside it. If the issue is already `In Progress` and assigned to someone else, STOP and ask.

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
- Do NOT write to Linear during plan mode - compose the plan in memory now and persist it only after the user approves (step 9).

## Step 5 - Compose the comprehensive plan (in memory, do not write yet)

The plan must be `/goal`-ready. It will go into the Linear issue description's `## Plan` block after approval (step 9). Required sections:

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
- <config.review.ensembleSize>x ensemble review before proposing the merge (one distinct stance per reviewer from `config.review.stances`, round-robin, identical full-PR scope), directly fixable findings as follow-up commits

### Risks / rollback
- <risk 1> -> <mitigation>
- Rollback path: <...>

### PR
- Base: `<config.git.baseBranch>`
- Title: `<issuePrefix>-XXX - <issue title>`
- Commit prefix: `<issuePrefix>-XXX - <short>`
```

In codex mode, the plan's `### DoD gates` section must state the delegation and the review mix (`<ensembleSize minus 1>x Claude + 1x Codex` instead of the plain `<ensembleSize>x` review line) - otherwise the spec-conformance reviewer's Plan/AC check and the composed condition disagree.

**Touch points are amendable mid-task.** The `## Plan` block is not frozen at approval. If the `/goal` loop later finds it insufficient, it uses the **amendment move** (defined in the AGENTS block): append an `### Amendments` sub-section to `## Plan` via `save_issue`, each entry recording reason, new touch points, and a LOC estimate. Autonomous only while the amendments add `<=2` new non-high-risk touch points in total (a touch point is any file that must change but was not in the original plan, created or edited); once they add more than 2, or any high-risk area (`config.areas.highRisk`), stop and ask first. That is why the `/goal` file-scope constraint below reads "amended plan" - a recorded amendment is not a violation, whereas a genuine scope change still means ask or a follow-up issue.

## Step 6 - Compose the /goal condition

The `/goal` command (Claude Code v2.1.139+) is a session-scoped stop hook: after every turn a small model checks the transcript against the condition. The condition therefore needs **measurable, transcript-verifiable end states**. Compose it exactly after this schema (single line, max ~3500 chars, in `config.language`, ready to send - replace every `<...>` with the concrete values from the config and this issue):

```
/goal <issuePrefix>-XXX plan fully implemented: the approved ## Plan block written to the issue description via save_issue, all implementation steps from that ## Plan block done (if the plan proves insufficient mid-task, amend it first - append `### Amendments` to ## Plan via save_issue with reason + new touch points + LOC estimate; autonomous only while amendments add <=2 new non-high-risk touch points total and no high-risk area, otherwise stop and ask), <config.gates.build> exit 0, all acceptance criteria boxes in the ## Acceptance Criteria section toggled to `- [x]` via save_issue, PR created against <config.git.baseBranch> (title: "<issuePrefix>-XXX - <title>"), <config.review.ensembleSize>x ensemble review executed (<config.review.ensembleSize> parallel review subagents in ONE message, identical broad scope, each assigned one distinct stance from config.review.stances round-robin - and when a spec-conformance stance is configured, the reviewer assigned it also given the issue reference and checking the diff against ## Plan and ## Acceptance Criteria) with consensus synthesis and follow-up commits for consensus findings, re-review loop on larger changes (threshold: new logic / high-risk / >50 LOC / >3 new files / interface change, max <config.review.maxRounds> rounds), BEFORE `gh pr merge` all DoD boxes in the ## Definition of Done section toggled to `- [x]` via save_issue and the ## Final Summary section set with merge-SHA placeholder + PR number plus state="In Review", auto-merge via `gh pr merge <N> --squash --delete-branch` only if all gates are green (base=<config.git.baseBranch>, build exit 0, all DoD boxes checked, no open majority critical findings, re-review loop finished, no user override), MANDATORY step after a successful merge: in the MAIN working copy (not the task worktree) run `git checkout <config.git.baseBranch> && git pull --ff-only` and confirm the new HEAD in a user message - this step must NOT be skipped, and AS THE LAST STEP BEFORE LOOP EXIT explicitly save_issue state="Done" plus a description patch with the real merge SHA in ## Final Summary (the loop must NOT stop earlier even if everything else looks finished). Constraints: no --no-verify, no hook bypass, no push to protected branches, no force push, <config.extraConstraints, comma-joined - omit if empty>, no files outside the amended plan's touch points. Stop after 40 turns if not fulfilled.
```

**Ensemble review fan-out (this is what the condition refers to):** launch `config.review.ensembleSize` review subagents in ONE message (true parallelism). Every subagent gets the **same identical broad-scope** prompt (code quality, bugs, logic, conventions, tests, edge cases, error handling, security, high-risk areas, performance) plus **one distinct stance** taken from `config.review.stances`, assigned round-robin across the reviewers (reviewer i -> `stances[i % stances.length]`), so the stances decorrelate the ensemble without narrowing anyone's scope. Tell each reviewer to lead with its stance's lens but still cover the whole diff. If `config.review.stances` includes `spec-conformance`, ensure one reviewer is assigned that stance - assign it explicitly if the round-robin position would otherwise fall outside `ensembleSize` - and give that reviewer the issue reference (`<issuePrefix>-XXX`) plus a check of the diff against the issue's `## Plan` and `## Acceptance Criteria`; if no such stance is configured, no reviewer performs the Plan/AC check. Ask each for a structured report (Critical / Important / Suggestions / Strengths) with `file:line` references; synthesize yourself (consensus >=2 fixed directly, singletons judged, conflicts decided).

**Codex delegation mode (only when codex mode is ON):** adjust the composed condition in exactly two places - everything else stays identical:

1. **Implementation clause:** replace `all implementation steps from that ## Plan block done` with: `all implementation steps from that ## Plan block done by delegating each step to the codex:codex-rescue subagent - every delegation prompt self-contained: the step itself, the plan's touch points, and the full loop constraints (no --no-verify, no hook bypass, no push to protected branches, no force push, <config.extraConstraints - omit if empty>, no files outside the amended plan's touch points; the delegate never sees this condition, so restate them verbatim) - fallback rule: a failed delegation gets exactly one retry via --resume (re-delegate resuming the failed Codex session instead of starting fresh), after which Claude implements the step itself and documents the fallback as an issue comment`.
2. **Review clause:** replace `<config.review.ensembleSize> parallel review subagents in ONE message, identical broad scope, each assigned one distinct stance from config.review.stances round-robin - and when a spec-conformance stance is configured, the reviewer assigned it also given the issue reference and checking the diff against ## Plan and ## Acceptance Criteria` with: `<ensembleSize minus 1>x Claude + 1x Codex (default ensembleSize 3: 2x Claude + 1x Codex) - <ensembleSize minus 1> parallel Claude review subagents plus the Codex reviewer started in the SAME message via node <companion from step 0a> adversarial-review --wait --base <config.git.baseBranch> --scope branch (read-only, structured review schema; if --wait would exceed the shell timeout, poll the companion's status command instead), identical broad scope for every reviewer; the Codex reviewer takes the adversarial stance, the spec-conformance stance (issue reference + diff checked against ## Plan and ## Acceptance Criteria) and the maintainer stance go to the Claude reviewers`. If `config.review.stances` deviates from the default set, the Codex reviewer takes `adversarial` when present, otherwise the first stance that is not `spec-conformance`; the remaining stances go round-robin to the Claude reviewers - a configured `spec-conformance` stance must always land on a Claude reviewer, and with fewer Claude reviewers than remaining stances, stack multiple stances on one Claude reviewer rather than dropping any.

The two substitutions add roughly 850 characters: in codex mode the composed condition can approach the ~3500-char guidance once high-risk/single-writer/extraConstraints additions apply - trim descriptive filler first, never the load-bearing clauses; slightly exceeding the guidance beats dropping a gate.

In the synthesis, treat the Codex reviewer's structured findings exactly like a Claude subagent report (consensus >=2 fixed directly, singletons judged, conflicts decided). The delegation itself changes nothing about merge gates, DoD boxes, or the Linear close-out - Claude remains the orchestrator and accountable for every gate.

If the issue touches a **high-risk area** (`config.areas.highRisk`), add to the constraints: `smaller commits, intermediate verification after every destructive data operation`.

If a `single-writer:<area>` label is active, add: `no parallel edits to <area> hot files while another issue is In Progress`.

If `config.merge.auto` is **false**, the loop must never run `gh pr merge`. Adjust the condition in two places: (1) change ``BEFORE `gh pr merge` `` to `BEFORE finishing`; (2) replace everything from ``auto-merge via `gh pr merge <N> --squash --delete-branch` `` up to and including the `state="Done"` clause with: `NO merge (merge.auto=false): AS THE LAST STEP BEFORE LOOP EXIT, after state="In Review" is set, report the PR URL and the gate status (base, build exit code, DoD boxes, open findings, review rounds) in a user message and stop - merging is the user's decision, do not run gh pr merge`. The `## Final Summary` keeps the merge-SHA placeholder; the user (or an explicitly instructed agent) merges later and closes out with `state="Done"` + the real SHA.

## Step 7 - ExitPlanMode

Present a compact overview via `ExitPlanMode`:

- Worktree path + branch
- Destructive-setup decision (one sentence, if applicable)
- Number of implementation steps
- Main risks (max 2 bullets)
- **The fully composed `/goal` command from step 6 in its own code block** (copy-paste ready)
- Note: "After approval I will write the plan into the Linear issue (## Plan block); then please send the `/goal` command."

## Step 8 - After plan approval (new turn)

As soon as the user approves the plan and the next turn begins: **do NOT start any implementation work yourself.** Instead:

1. Persist the plan: `save_issue` with the full description body (add/replace the `## Plan` block, keep the existing `## Acceptance Criteria` and `## Definition of Done` content). Read with `get_issue` first, patch precisely, write back - the description API replaces the whole body. (The issue was already claimed `In Progress` in step 1.)
2. Reply with exactly this structure:

```
Plan approved and written to the issue. Please start the autonomous loop:

/goal <condition from step 6>

(Into the chat line, then Enter.)
```

Wait for the user's `/goal` command. Only when it arrives does implementation begin - and then **not through this slash command** but through the official `/goal` loop.

Rationale: `/goal` cannot technically be triggered from within a slash command. The `/goal` loop beats a DIY continue: per-turn completion check, automatic stop on the bounding clause, robust against intermediate errors, recoverable via `--resume`.

## Hard rules

- In steps 0-8: NO code changes, NO destructive setup runs, NO commit/push/PR. The only Linear mutations are the `In Progress` claim (step 1) and, after approval, the plan write (step 8). Implementation happens exclusively in the subsequent `/goal` loop.
- Destructive setup commands only after explicit user confirmation.
- With an active `single-writer:<area>` label: re-check for competing `In Progress` issues before step 6; on conflict ask the user.
- The goal condition must be **measurable in the transcript** - no conditions like "code is clean".
- All description patches via `save_issue` with the complete description body: `get_issue` first, patch precisely, write back.
- At most one active `/goal` per worktree.
