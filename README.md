# agent-taskflow

Wiederverwendbares Task-Workflow-Framework fuer agentengestuetzte Softwareprojekte (Claude Code + Linear + GitHub). Extrahiert und generalisiert aus dem PeakShare/Colibrie-Migrations-Workflow (Juli 2026).

Kernidee: Ein Linear-Issue ist die Single Source of Truth pro Task. Zwei Slash-Commands strukturieren den Weg dorthin (`/create-issue`) und hindurch (`/start-task` -> `/goal`-Loop), ein Review-Ensemble und harte Auto-Merge-Gates sichern die Qualitaet, ein PreToolUse-Hook erzwingt die Git-Regeln maschinell.

## Inhalt

- [WORKFLOW.md](WORKFLOW.md) - das Framework: Prinzipien, Issue-Schema, Task-Lifecycle, Review-Ensemble, Auto-Merge-Gates, /goal-Schema, Adoptions-Anleitung
- [templates/commands/create-issue.md](templates/commands/create-issue.md) - parametrisierter Slash-Command: Issue nach Schema anlegen (Interferenz-Check + PlanMode-Drafting)
- [templates/commands/start-task.md](templates/commands/start-task.md) - parametrisierter Slash-Command: Worktree + Plan + /goal-Condition fuer ein Issue
- [templates/AGENTS-task-lifecycle.md](templates/AGENTS-task-lifecycle.md) - Snippet fuer die AGENTS.md/CLAUDE.md des adoptierenden Projekts
- [templates/hooks/branch-guard.mjs](templates/hooks/branch-guard.mjs) - konfigurierbarer Guard-Hook (PR-Base, protected Branches, --no-verify, Force-Push)
- [templates/settings-hook-snippet.json](templates/settings-hook-snippet.json) - Hook-Verdrahtung fuer .claude/settings.json

## Adoption in 6 Schritten

1. Linear-Team (eigener Issue-Prefix) und ggf. Default-Project anlegen
2. `templates/commands/*` nach `<projekt>/.claude/commands/` kopieren
3. Alle `{{PLATZHALTER}}` ersetzen (Tabelle in WORKFLOW.md, Sektion "Adoption")
4. `templates/hooks/branch-guard.mjs` kopieren, `CONFIG` oben anpassen, via settings.json verdrahten
5. `templates/AGENTS-task-lifecycle.md` (Platzhalter ersetzt) in die Projekt-AGENTS.md uebernehmen
6. Optional: `ensemble-reviewer`-Subagent im Projekt definieren (sonst Fallback `general-purpose`)

Referenz-Adoption: das Repo `factotum` (gleicher Developer-Ordner).

## Hinweise

- Sprache der Templates: Deutsch (an eigene Projekt-Konvention anpassen).
- Der Workflow setzt Claude Code v2.1.139+ (`/goal`-Command) und das Linear-MCP-Plugin voraus.
- Bewusst NICHT enthalten: Session-Rename-Choreografie (in frueheren Versionen des Ursprungs-Workflows vorhanden, entfernt).
