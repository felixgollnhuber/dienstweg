---
description: Neues Linear-Issue ({{ISSUE_PREFIX}}-XXX) nach Repo-Schema anlegen - Interferenz-Check + gemeinsames PlanMode-Drafting
argument-hint: <kurze Themenbeschreibung, optional>
---

Du legst jetzt ein neues Linear-Issue zum Thema `$ARGUMENTS` an. Ziel: nach Repo-Konvention (siehe AGENTS.md Sektion "Task-Lifecycle") ein vollstaendiges, sauber geplantes Issue mit Description-Template, AC, DoD, korrekten Labels und Project-Zuordnung, ohne Konflikte zu parallel laufenden Issues.

**Sprache: Deutsch (siehe AGENTS.md/CLAUDE.md).**

**Harte Regel vorab**: In diesem Command wird **kein Code geaendert**, **kein Branch erstellt**, **kein Worktree initialisiert** und **kein State auf "In Progress"** gesetzt. Das alles macht erst danach `/start-task {{ISSUE_PREFIX}}-XXX`. Hier wird nur ein Issue im Backlog erzeugt.

## Schritt 1 - Thema verstehen

- Wenn `$ARGUMENTS` leer ist: via `AskUserQuestion` nach dem Thema fragen (Titel-Idee + 1-3 Saetze Kontext). Nicht raten.
- Wenn `$ARGUMENTS` da ist, aber unklar: nachfragen, was konkret gemacht werden soll, **bevor** Schritt 2 startet.
- Identifiziere grob den **Bereich** (siehe {{SINGLE_WRITER_AREAS}} und {{HIGH_RISK_AREAS}}). Das steuert spaeter Labels, Risiken und DoD-Gates.

## Schritt 2 - Repo-Kontext + Linear-Kontext laden

Parallel ausfuehren (keine Abhaengigkeiten):

- `mcp__plugin_linear_linear__list_teams` -> Team `{{LINEAR_TEAM}}` finden (Default-Team fuer dieses Repo).
- `mcp__plugin_linear_linear__list_projects` -> aktive Projects auflisten. Default-Project: {{DEFAULT_PROJECT}} (`-` = kein Project, Team-Backlog). Wenn der User explizit ein Project genannt hat, das verwenden.
- Falls ein Project gesetzt ist: `mcp__plugin_linear_linear__list_milestones project="<projectId>"` fuer die Zuordnung in Schritt 5.
- `mcp__plugin_linear_linear__list_issue_labels team="{{LINEAR_TEAM}}"` -> vorhandene Labels (insbesondere `parallel-safe` und alle `single-writer:<bereich>`) cachen. Wichtig: ohne `team`-Parameter fehlen team-scoped Labels. Wenn ein noetiges Label fehlt, in Schritt 5 via `create_issue_label` anlegen - aber nur nach explizitem User-OK.

## Schritt 3 - Interferenz-Check (Pflicht, parallel zu Schritt 2)

Ziel: Issues finden, die mit dem geplanten Thema kollidieren - inhaltlich, durch geteilte Files/Module, oder durch single-writer-Locks. Fuehre **alle** Checks aus (in einer Tool-Batch):

1. **Alle aktiv laufenden Issues**: `list_issues team="{{LINEAR_TEAM}}" state="In Progress"` - heisseste Konfliktkandidaten (Branches/Worktrees existieren).
2. **Alle "In Review"-Issues**: `list_issues team="{{LINEAR_TEAM}}" state="In Review"` - offene PRs koennten den Scope schon abdecken.
3. **Single-Writer-Locks im betroffenen Bereich**: passt der Bereich aus Schritt 1 zu einem `single-writer:<bereich>`-Label ({{SINGLE_WRITER_AREAS}}), pruefe `list_issues label="single-writer:<bereich>" state="In Progress"` und `state="In Review"`.
4. **Themenaehnliche Backlog-Issues**: `list_issues team="{{LINEAR_TEAM}}" state="Backlog"` und `state="Todo"`, lokal auf Titel-Stichwoerter filtern (case-insensitive). Bei >50 Treffern nur Top-Treffer auswerten.

Aus den Ergebnissen eine **Konflikt-Tabelle** bauen (Issue, State, Bereich/Label, Konfliktart, Wirkung auf neues Issue).

Wenn ein bestehendes Issue das Thema **bereits abdeckt**: STOP, dem User die Treffer im PlanMode zeigen und fragen, ob das alte Issue genutzt/erweitert wird oder das neue trotzdem als getrennter Scope entsteht.

## Schritt 4 - PlanMode aktivieren und gemeinsam planen

- Rufe `EnterPlanMode` auf.
- Praesentiere zuerst die **Konflikt-Tabelle** kompakt (auch wenn leer - dann explizit "Keine Interferenzen gefunden").
- Stelle dann via `AskUserQuestion` so viele Fragen wie noetig. **Lieber 2-3 Fragen mehr als eine stillschweigende Annahme.** Typische Themen:
  - **Titel**: Vorschlag + Bestaetigung. Kurz, beschreibend, ohne Prefix (vergibt Linear).
  - **Scope-Abgrenzung**: dieses Issue vs. Folge-Issue?
  - **Acceptance Criteria**: 2 bis max. 6-8 atomare, pruefbare Kriterien, je eine Checkbox.
  - **Priority**: Urgent (1) / High (2) / Medium (3) / Low (4). Default Medium.
  - **Project + Milestone**: Default {{DEFAULT_PROJECT}}; Milestone nur falls passend.
  - **Labels**: Pflicht genau eines von `parallel-safe` ODER `single-writer:<bereich>`. Bereich unklar -> User fragen.
  - **Relations**: Parent / Blocked-by / Blocks? Falls via `save_issue` nicht setzbar: in `## Setup` als `Blocked by: {{ISSUE_PREFIX}}-XXX` notieren.
  - **High-Risk-Bereich** ({{HIGH_RISK_AREAS}}) beruehrt? Dann DoD verschaerfen (Schritt 5).
  - **Plan vorab skizzieren?** Optional; bei "nein" bleibt `## Plan` Platzhalter fuer `/start-task`.

## Schritt 5 - Description nach Repo-Template komponieren

Baue die komplette Description nach dem Pflicht-Template (AGENTS.md Sektion "Task-Lifecycle"):

```markdown
## Plan
<falls in Schritt 4 grob geplant: hier rein; sonst: "TBD - wird im /start-task befuellt">

## Acceptance Criteria
- [ ] AC #1
- [ ] AC #2

## Definition of Done
- [ ] {{BUILD_CHECKS}} exit 0
- [ ] Acceptance Criteria erfuellt + abgehakt
- [ ] Keine unautorisierten Side-Effects (Cronjobs/Webhooks/destruktive Skripte)
- [ ] High-Risk-Bereiche ({{HIGH_RISK_AREAS}}) verifiziert
- [ ] Keine Secrets im Code
- [ ] Single-Writer-Lock geprueft (parallel-safe oder Lock-frei zur Merge-Zeit)
- [ ] 3-fach-Ensemble-Review durchgefuehrt
- [ ] PR-Base = {{BASE_BRANCH}}
{{PROJECT_EXTRA_DOD}}

## Setup
- Worktree: <wird in /start-task gesetzt>
- Single-Writer-Lock: <parallel-safe | single-writer:<bereich>>
- Blocked by: <{{ISSUE_PREFIX}}-XXX, falls vorhanden>

## Final Summary
<wird vor State=Done gesetzt>
```

Vor dem Create: dem User im PlanMode den **vollstaendigen Body + Metadata** (Titel, Project, Milestone, Labels, Priority, Relations) zeigen. Aenderungswunsch -> zurueck zu Schritt 4.

## Schritt 6 - ExitPlanMode

Praesentiere via `ExitPlanMode` eine kompakte Uebersicht zur Freigabe: Titel, Project + Milestone, Priority, Labels (parallel-safe vs. single-writer hervorheben), Anzahl AC + DoD-Items, Konflikt-Status (1 Satz), kompletter Description-Body als Markdown-Block.

Hinweis am Ende: "Nach Approval wird das Issue via `save_issue` (ohne `id`) im Backlog angelegt. Es wird **nicht** auf `In Progress` gesetzt - das macht erst `/start-task {{ISSUE_PREFIX}}-XXX`."

## Schritt 7 - Nach Approval: Issue anlegen

1. `mcp__plugin_linear_linear__save_issue` **ohne `id`** (Create-Modus): `team="{{LINEAR_TEAM}}"`, `title`, `description` (kompletter Body), `project` (falls gesetzt), `milestone` (falls vergeben), `priority`, `labels`, `state` = Default-Backlog-State. `assignee` nur auf expliziten User-Wunsch.
2. **Erfolg verifizieren**: vergebenen Identifier extrahieren, mit `get_issue` nachlesen. Fehlen Sektionen/Labels: patchen via erneutem `save_issue`.
3. **Relations**, die nicht via `save_issue` setzbar waren: als Comment notieren (`save_comment`) + Hinweis im User-Output, dass die Verlinkung in der Linear-UI geklickt werden muss.

## Schritt 8 - Abschluss-Output an den User

```
Issue angelegt: {{ISSUE_PREFIX}}-XXX - <Titel>
URL: <Linear-URL>

Project: <Name oder ->
Milestone: <Name oder ->
Priority: <Wert>
Labels: <Liste>
Konflikt-Status: <kurz>

Naechster Schritt (optional):
/start-task {{ISSUE_PREFIX}}-XXX   - Worktree anlegen + Plan-Mode fuer Implementation
```

Hatte die Konflikt-Tabelle Treffer und der User legt trotzdem an: Konflikte am Ende nochmal listen + Begruendung wiederholen (Session-History).

## Harte Regeln

- Keine Code-Aenderungen, keine Branch-/Worktree-Erstellung, kein Build-/Setup-Run in diesem Command. Reines Linear-MCP-Drafting.
- KEIN State="In Progress", KEIN `assignee="me"` ohne expliziten User-Wunsch.
- Labels NUR aus dem Ergebnis von `list_issue_labels team="{{LINEAR_TEAM}}"` referenzieren; neue Labels nur nach User-OK via `create_issue_label`.
- Description IMMER nach dem Template - keine eigene Struktur erfinden.
- Deckt ein existierendes Issue das Thema ab: standardmaessig **kein** neues Issue, sondern User entscheiden lassen.
- Bei Unsicherheit ueber den Bereich: lieber `single-writer:<bereich>` als faelschlich `parallel-safe`.
- Tool-Calls parallelisieren (Schritt 2 + 3 in einer Batch).
