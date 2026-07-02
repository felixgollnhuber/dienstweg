# Snippet fuer die Projekt-AGENTS.md (Platzhalter ersetzen, dann als Sektion uebernehmen)

## Task-Lifecycle (Pflicht)

Dieses Projekt nutzt den agent-taskflow-Workflow (Repo `agent-taskflow`). Tasks laufen ueber Linear (Team `{{LINEAR_TEAM}}`, Prefix `{{ISSUE_PREFIX}}-XXX`), alle Issue-Operationen via Linear-MCP (`mcp__plugin_linear_linear__*`), nie via REST oder lokale Files.

**Commands:**

- `/create-issue <thema>` - neues Issue nach Schema (Interferenz-Check + PlanMode-Drafting). Legt NUR das Backlog-Issue an.
- `/start-task {{ISSUE_PREFIX}}-XXX` - Worktree + Plan in die Issue-Description + fertige `/goal`-Condition. Implementierung erst im `/goal`-Loop.

**Git-Konventionen:**

- Base-Branch: `{{BASE_BRANCH}}`. Feature-Branches: `tasks/{{issue_prefix_lower}}-XXX-<slug>`.
- Commit: `{{ISSUE_PREFIX}}-XXX - Kurzbeschreibung`. PR-Titel: `{{ISSUE_PREFIX}}-XXX - Task-Titel`, Base immer `{{BASE_BRANCH}}` (explizit).
- Kein `--no-verify`, kein Force-Push auf shared Branches, kein direkter Push auf protected Branches (branch-guard-Hook blockt).
- Merge: `gh pr merge <N> --squash --delete-branch`, danach PFLICHT: `git checkout {{BASE_BRANCH}} && git pull --ff-only` + HEAD bestaetigen.

**Issue-Disziplin:**

1. Claim: `save_issue state="In Progress" assignee="me"`.
2. Plan VOR Code in die Description (Sektion `## Plan`). Non-negotiable.
3. AC-Boxen via Description-Patch abhaken, Notes als Comments, Scope-Aenderungen nie stillschweigend.
4. Vor Merge: alle AC- + DoD-Boxen abhaken, `## Final Summary` (Merge-SHA-Platzhalter + PR-Nr.), `state="In Review"` - als letzter Commit auf dem Branch.
5. Nach Merge: `state="Done"` + Final Summary mit echter Merge-SHA.

**Parallelitaet:** Pro Issue genau ein Label: `parallel-safe` oder `single-writer:<bereich>` (Bereiche: {{SINGLE_WRITER_AREAS}}). Vor Start pruefen, ob ein anderes Issue denselben Lock haelt.

**Review (Pflicht vor jedem Merge):** 3-fach-Ensemble-Review - 3 parallele Review-Subagents (subagent_type=ensemble-reviewer falls definiert, sonst general-purpose) in EINER Message, identischer breiter Scope, keine Aufteilung. Konsens-Findings direkt fixen, Singletons kritisch bewerten, Konflikte explizit entscheiden. Re-Review bei groesseren Fix-Aenderungen (neue Logik / High-Risk / >50 LOC / >3 neue Files / Interface-Change), max. 3 Runden. Ein einzelner Review-Aufruf ersetzt das Ensemble nicht.

**Auto-Merge (Default):** Nach sauberem Review-Loop autonom mergen - kein Nachfragen. Gates (alle Pflicht): PR-Base = `{{BASE_BRANCH}}`, {{BUILD_CHECKS}} exit 0 nach den letzten Fix-Commits, keine offenen DoD-Boxen (vor Merge via `get_issue` pruefen), keine offenen [3/3]/[2/3]-Critical-Findings, Re-Review-Loop abgeschlossen, kein User-Override ("merge nicht automatisch" gilt fuer die ganze Session). Gate verletzt -> nicht mergen, Status-Report.

**High-Risk-Bereiche** ({{HIGH_RISK_AREAS}}): kleinere Commits, Zwischen-Verifikation nach destruktiven Operationen, im Review separat ausweisen.
