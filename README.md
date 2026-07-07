<div align="center">

# dienstweg

**Make coding agents follow proper procedure.**

A config-driven task workflow for agent-assisted development. One Linear issue as the source of truth, an ensemble review before every merge, and a git guardrail that stops the mistakes before they land — installed into any repo with one command, updatable across all of them with one more. Works the same in **Claude Code and Codex**: both harnesses are set up automatically, each with its own native command surface and the same git guardrail.

![npm](https://img.shields.io/npm/v/dienstweg?style=flat-square&color=2563eb)
![tests](https://img.shields.io/github/actions/workflow/status/felixgollnhuber/dienstweg/test.yml?style=flat-square&label=tests)
![node](https://img.shields.io/badge/node-%E2%89%A520-3fb950?style=flat-square)
![dependencies](https://img.shields.io/badge/dependencies-0-3fb950?style=flat-square)
![harness](https://img.shields.io/badge/Claude_Code_%2B_Codex_%2B_Linear_%2B_GitHub-1f2328?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-3fb950?style=flat-square)

</div>

---

> **Dienstweg** *(German, der)* — the official channels; the proper procedure.
> *„Immer schön den Dienstweg einhalten."* — always go through the proper channels.

That is the entire philosophy. An agent with shell access will cheerfully `git push --force origin main`, open a PR against the wrong branch, or declare a task "done" with no review and half the acceptance criteria unchecked. dienstweg installs the proper channels — plans in the issue, review before merge, protected branches — and makes routing around them the hard path instead of the default one.

## The idea in 30 seconds

Every task is a Linear issue with a real plan. Two commands — Claude Code slash-commands, Codex skills — walk the agent through it, a redundant review runs before anything merges, and a hook enforces the git rules at the moment of the mistake:

```
/create-issue   →   /start-task   →   /goal loop   →   ensemble review   →   auto-merge
  draft the         plan into the      implement,        3 independent        only when every
  issue, check      issue, claim it,   verify, open      reviewers, fix        gate is green,
  for interference  emit the goal      the PR            the consensus         then sync base
```

The clever part is what makes it reusable: **the commands and the hook are generic and read a per-repo config file at runtime.** Nothing is hand-templated into your repo, so a workflow improvement ships to every adopting repo as a plain overwrite — no merge, no drift.

## Quickstart

```bash
# in any repo you want to adopt the workflow (zero dependencies):
cd ~/my-project
npx dienstweg init

# or install once, globally:
npm i -g dienstweg
```

`init` runs a short interview — existing project or fresh repo, project name, language (English by default), which harnesses (both by default), Linear team & issue prefix, base branch, build gates, auto-merge on/off, high-risk and single-writer areas — and writes everything it needs:

```
dienstweg v0.3.1 initialized for "my-project"
  config:   dienstweg.config.json (team MyProject, prefix MYP, base main, harnesses claude + codex)
  written:  .claude/commands/create-issue.md
  written:  .claude/commands/start-task.md
  written:  .claude/hooks/branch-guard.mjs
  written:  .agents/skills/create-issue/SKILL.md
  written:  .agents/skills/start-task/SKILL.md
  written:  .codex/hooks/branch-guard.mjs
  settings.json: added branch-guard PreToolUse hook
  .codex/hooks.json: added branch-guard PreToolUse hook
  AGENTS.md: created with dienstweg block
  CLAUDE.md: created as @AGENTS.md import
  written:  dienstweg.local.md (project-owned stub)
```

Pick a single harness with `--harness claude` or `--harness codex` if you don't want both.

Then create your first task — in Claude Code:

```
/create-issue add rate limiting to the public API
/start-task MYP-1
```

In Codex the same two live as repo-committed skills — invoke them from the `/skills` menu, with `$create-issue` / `$start-task`, or just by describing the intent ("create an issue for rate limiting", "start MYP-1").

## Onboarding an existing repo (the interesting case)

Dropping a workflow onto a repo that already has its own rules is where things usually break. dienstweg splits the job: **the CLI does the mechanical part, an agent does the semantic part.**

`init` never overwrites a colliding file, then emits a self-contained **onboarding prompt** (printed and saved to `.dienstweg/onboarding-prompt.md`). You hand that prompt to Claude Code or Codex, and it audits the repo for rules that contradict the workflow — a different PR base in `CONTRIBUTING.md`, a competing commit convention in `CLAUDE.md`, a rival PreToolUse hook, CI branch filters — and proposes, per finding, one of three resolutions:

- **dienstweg wins** — remove or adjust the old rule.
- **project wins** — encode the exception in `dienstweg.config.json` or `dienstweg.local.md`.
- **you decide** — it surfaces the trade-off and asks.

Nothing changes until you approve. It finishes by running `dienstweg check` until the setup is clean.

## How it works — configuration, not instantiation

```
your-repo/
├── dienstweg.config.json     ← the only file you edit: harnesses, team, prefix, base, gates, areas, merge
├── dienstweg.local.md        ← project-owned rules the config can't express
├── AGENTS.md                 ← workflow block between <!-- dienstweg:begin/end --> markers (both harnesses read it)
├── CLAUDE.md                 ← @AGENTS.md import (Claude Code; Codex reads AGENTS.md natively)
├── .claude/                  ← Claude Code harness  ┐
│   ├── commands/             ← slash-commands        │
│   ├── hooks/branch-guard.mjs ← generic guard        │
│   └── settings.json         ← hook wired in         │ tool-owned,
├── .agents/skills/           ← Codex skills (repo-committed prompts)  │ generic,
│   ├── create-issue/SKILL.md                                          │ read the config
│   └── start-task/SKILL.md                                            │ at runtime,
└── .codex/                   ← Codex harness         │ never edited
    ├── hooks/branch-guard.mjs ← same guard, byte-identical  │
    └── hooks.json            ← hook wired in (merged, never clobbered)  ┘
.dienstweg/manifest.json      ← content hashes of the tool-owned files
```

Tool-owned files carry a `DO NOT EDIT` header and are tracked by hash. You never touch them — every customization goes through the config or `dienstweg.local.md`. Because of that contract, updates are trivial:

```bash
dienstweg update   # regenerate tool-owned files, run any config migrations, bump the stamp
dienstweg check    # verify config, file hashes, hook wiring, and the AGENTS block
```

`check` is a real doctor: it re-renders the AGENTS block from your config to catch hand-edits *or* staleness, flags hand-edited generated files, detects corrupted markers and broken settings — and it never crashes on the broken states it exists to diagnose. Versions are semver git tags; schema changes ship as migrations that run automatically during `update`.

## The guardrail (honest by design)

`branch-guard` is a PreToolUse hook that blocks the everyday git mistakes at the moment they happen — and it tells you exactly why:

```
$ git push --force origin main
[branch-guard] BLOCKED: git push --force to 'main' is destructive on a shared
branch and requires explicit user authorization.
```

It catches the real forms agents actually emit: `git push -u origin main`, `HEAD:main`, `+main`, `:main`, `--delete main`, subshell `(git push origin main)`, `git -C dir push`, `git commit -n`, PRs against the wrong base — while staying quiet on the legitimate ones (`main-hotfix`, `--base=main`, the word "main" inside a commit message).

It also blocks `git add` of a secret file — `.env`, `*.pem`, `id_rsa*`, `credentials*` — before it can ride into a commit, while leaving harmless look-alikes like `.env.example` and public keys like `id_rsa.pub` alone. Matching is case-insensitive (so `CERT.PEM` is caught on macOS/Windows too). The denylist is tunable via an optional `guard` block in `dienstweg.config.json`: `secretDenylist` extends the defaults (or replaces them with `secretDenylistReplace: true`), and `secretAllowlist` adds exceptions.

Every decision it makes — a block, a warning, or a **fail-open** (when a broken config forces it to allow) — is appended as one JSON line to `.dienstweg/guard-log.jsonl` (gitignored, best-effort, and unable to change the decision itself). `dienstweg check` then summarizes recent blocks per rule and, crucially, turns recent fail-open events into a FAIL — so a guard that fell open because its config was unreadable is loud, not silent.

It is deliberately **a guardrail against honest mistakes, not a security sandbox.** A determined bypass through obfuscation is always possible, and that is fine — the goal is to stop the slip, not to contain a hostile actor. The docs say so everywhere they can.

## Command reference

| Command | What it does |
| --- | --- |
| `dienstweg init` | Interactive setup. `--yes` for non-interactive; every question has a flag (`--name`, `--prefix`, `--team`, `--base`, `--gates`, `--auto-merge`/`--no-auto-merge`, `--high-risk`, `--single-writer`, `--new`/`--existing`). |
| `dienstweg update` | Regenerate tool-owned files, run config migrations, bump the version stamp. `--force` also overwrites hand-edited files. |
| `dienstweg check` | Verify the whole setup. Exit 0 = clean. |
| `dienstweg version` · `help` | The obvious. |

And inside the agent — Claude Code slash-commands, or the equivalent Codex skills:

| Command / skill | What it does |
| --- | --- |
| `create-issue <topic>` | Draft a schema-conformant issue after an interference check. Creates the backlog issue only. |
| `start-task <PREFIX>-N` | Claim the issue, set up a worktree, plan it, and hand you a ready-to-run `/goal` condition. |

### Invoking them in each harness

The two commands live in each harness's native, repo-committed form — and they're invoked differently, because Codex has no user-defined `/`-commands:

- **Claude Code** — real slash-commands under `.claude/commands/`. Type `/create-issue <topic>` or `/start-task DW-1`.
- **Codex** — repo-committed **skills** under `.agents/skills/`, invoked three ways:
  - `/skills` → pick `create-issue` or `start-task` from the menu;
  - `$create-issue add rate limiting` — type `$` to mention a skill, then your topic;
  - or just describe the intent — `create a dienstweg issue for rate limiting`, `start task DW-1` — and Codex activates the skill by its `description`.

  Typing `/create-issue` in Codex does **not** work: Codex's only user-extensible, repo-shared prompt mechanism is skills (custom `/`-prompts are global-only and deprecated). Skills also have no `$ARGUMENTS` placeholder — whatever you write alongside the invocation is the input, and the skill reads it from your message.

`/goal` is a built-in in **both** harnesses, so the `/goal` handoff that ends `start-task` is identical either way.

## What's in the box

- **Ensemble review** — three independent reviewers, identical broad scope, run before every merge. Consensus findings are high-signal and fixed directly; singletons are judged; conflicts are decided, not averaged. Re-review triggers on larger fix changes, capped at three rounds. To decorrelate the ensemble, each reviewer keeps the full-PR scope but takes a **distinct stance** from `review.stances` (default `adversarial`, `spec-conformance`, `maintainer`), assigned round-robin across the reviewers; the `spec-conformance` stance name is load-bearing — the reviewer assigned it also checks the diff against the issue's `## Plan` and `## Acceptance Criteria`. In Claude Code, reviewers run as the subagent type named in `review.subagentType` (default `ensemble-reviewer`) — that agent is **yours to define** (e.g. `.claude/agents/ensemble-reviewer.md`); if your repo doesn't define one, reviewers fall back to `general-purpose`.
- **Hard auto-merge gates** — base branch, green build, all DoD boxes checked, no open critical findings, review loop finished, no user override. Any gate red → it reports instead of merging. Auto-merge itself is a config switch (`merge.auto`, default on): off means the agent stops at *In Review* and hands the merge to you.
- **Single-source issues** — plan, acceptance criteria, definition of done, and final summary all live in the Linear issue. No local backlog files, no task state stranded in a chat.
- **Parallelism labels** — `parallel-safe` vs. `single-writer:<area>` to keep concurrent agents off each other's hot files.

## Requirements

Node ≥ 20 · git · at least one of [Claude Code](https://claude.com/claude-code) v2.1.139+ or [Codex CLI](https://developers.openai.com/codex) (both provide `/goal`) · a Linear MCP server · the `gh` CLI.

Developed and tested on macOS/Linux; Windows is untested — reports welcome.

The full workflow — issue schema, git conventions, review protocol, auto-merge gates, the `/goal` condition — is documented in [WORKFLOW.md](WORKFLOW.md).

---

<div align="center">
<sub><a href="LICENSE">MIT</a> · <a href="CONTRIBUTING.md">Contributing</a> · <a href="SECURITY.md">Security & threat model</a></sub>
</div>
