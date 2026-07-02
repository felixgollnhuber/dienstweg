---
description: Worktree + Plan-Mode fuer ein Linear-Issue vorbereiten (1-Run-Setup fuer /goal)
argument-hint: <ISSUE-IDENTIFIER> (z.B. 123 oder {{ISSUE_PREFIX}}-123)
---

Du bereitest jetzt das Linear-Issue `$ARGUMENTS` fuer die Bearbeitung vor. Ziel: Worktree + umfassender Plan in der Linear-Issue-Description (Sektion `## Plan`), sodass danach `/goal` ohne weitere Rueckfragen durcharbeiten kann.

**Sprache: Deutsch (siehe AGENTS.md/CLAUDE.md).**

## Schritt 1 - Issue laden

- Normalisiere `$ARGUMENTS` auf das Format `{{ISSUE_PREFIX}}-XXX` (z.B. `123` -> `{{ISSUE_PREFIX}}-123`).
- `mcp__plugin_linear_linear__get_issue id="{{ISSUE_PREFIX}}-XXX"` aufrufen. Lies: Titel, Description (inkl. Sektionen `## Plan`, `## Acceptance Criteria`, `## Definition of Done`, `## Setup`, `## Final Summary`), Labels, Project, Milestone, Relations, State.
- Wenn das Issue nicht existiert oder bereits `Done` ist: STOP, User fragen.
- Pruefe Parallel-Labels (`parallel-safe`, `single-writer:<bereich>`) und logge sie kurz.
- Wenn die Description leer ist oder das Template fehlt: Description-Template aus der AGENTS.md (Sektion "Task-Lifecycle") als Skelett anlegen, AC + DoD aus dem Issue-Titel ableiten und vor Schritt 4 dem User zur Freigabe vorlegen.

## Schritt 2 - Worktree sicherstellen

- Branch-Name: `tasks/{{issue_prefix_lower}}-XXX-<kurz-slug>` (Slug aus Issue-Titel, max. 4-5 Worte, kebab-case, lowercase).
- Worktree-Pfad: `.claude/worktrees/tasks+{{issue_prefix_lower}}-XXX-<slug>` relativ zum Main-Repo.

Pruefe zuerst via `git worktree list`, ob fuer dieses Issue schon ein Worktree existiert:

- **existiert** + cwd zeigt darauf: Anlage skippen, ggf. {{SETUP_CMD}} (idempotent), weiter zu Schritt 3.
- **existiert** + cwd zeigt woanders: STOP, User fragen ob der existierende Worktree genutzt werden soll.
- **existiert nicht**: anlegen (unten), danach in den Worktree wechseln (cwd!).

**Anlage** ({{WORKTREE_HELPER}} = `-` bedeutet plain Git):

```
git worktree add .claude/worktrees/tasks+{{issue_prefix_lower}}-XXX-<slug> -b tasks/{{issue_prefix_lower}}-XXX-<slug> {{BASE_BRANCH}}
cd .claude/worktrees/tasks+{{issue_prefix_lower}}-XXX-<slug> && {{SETUP_CMD}}
```

Falls das Projekt ein Helper-Script definiert ({{WORKTREE_HELPER}}), stattdessen dieses verwenden - es ist die Single Source of Truth fuer das Setup.

## Schritt 3 - Demo-Daten-Entscheidung (NICHT ausfuehren, nur entscheiden)

{{DEMO_DATA_CMD}} = `-`: Dieser Schritt entfaellt fuer dieses Projekt; im Plan-Block unter "Setup" notieren `Demo-Daten: nicht erforderlich`.

Sonst: Beurteile aus Issue-Inhalt + AC, ob das Demo-Daten-Setup (`{{DEMO_DATA_CMD}}`) fuer die manuelle Verifikation noetig ist. Bei "noetig": im Plan-Block notieren `{{DEMO_DATA_CMD}} (optional, vor manueller Verifikation)`. **NICHT** im /start-task ausfuehren - destruktiv, der User entscheidet.

## Schritt 4 - PlanMode aktivieren und Fragen stellen

- Rufe `EnterPlanMode` auf.
- Stelle im PlanMode so viele Fragen via `AskUserQuestion` wie noetig, um Ambiguitaeten aufzuloesen. **Lieber 2 Fragen mehr als eine stillschweigende Annahme.** Typische Themen:
  - Scope-Abgrenzung: was gehoert in dieses Issue, was wird Folge-Issue?
  - Welche konkreten Files/Komponenten angefasst werden
  - Test-Strategie (Unit / Integration / Manual)
  - Schema-/Format-Auswirkungen, Rollback-Pfad
  - Abhaengigkeiten zu parallelen Issues (vorher `mcp__plugin_linear_linear__list_issues state="In Progress" label="single-writer:<bereich>"`)
- Erst wenn alle wesentlichen Fragen geklaert sind: weiter zu Schritt 5.

## Schritt 5 - Umfassenden Plan schreiben

Der Plan muss `/goal`-tauglich sein. Er wird in die Linear-Issue-Description in den `## Plan`-Block geschrieben. Pflicht-Sektionen:

```markdown
## Plan

### Setup
- Worktree: <pfad> auf Branch <branch>
- Demo-Daten: <noetig | nicht erforderlich>

### Touch-Points (konkrete Files)
- <pfad/file-a> - <was geaendert wird>
- <pfad/file-b> - <was geaendert wird>

### Implementierungs-Schritte (in Reihenfolge)
1. ...
2. ...

### Tests
- Unit: <welche Tests / wo>
- Integration: <ja/nein, welche>
- Manuelle Verifikation: <welche Flows>

### DoD-Gates
- {{BUILD_CHECKS}}
- 3-fach-Ensemble-Review vor Merge-Vorschlag, direkt fixbare Findings als Folge-Commit

### Risiken / Rollback
- <Risiko 1> -> <Mitigation>
- Rollback-Pfad: <...>

### PR
- Base: `{{BASE_BRANCH}}`
- Titel: `{{ISSUE_PREFIX}}-XXX - <Issue-Titel>`
- Commit-Prefix: `{{ISSUE_PREFIX}}-XXX - <Kurz>`
```

## Schritt 6 - Plan in die Issue-Description schreiben, State setzen

- `mcp__plugin_linear_linear__save_issue id="{{ISSUE_PREFIX}}-XXX" description="<voller body mit aktualisiertem ## Plan-Block>"` - ersetzt die komplette Description; vorhandene Sektionen (`## Acceptance Criteria`, `## Definition of Done`) erhalten, nur `## Plan` ergaenzen/ueberschreiben.
- `mcp__plugin_linear_linear__save_issue id="{{ISSUE_PREFIX}}-XXX" state="In Progress" assignee="me"`.

## Schritt 7 - Goal-Condition fuer den `/goal`-Loop formulieren

Der `/goal`-Command (Claude Code v2.1.139+) ist ein session-scoped Stop-Hook: nach jedem Turn prueft ein Kleinmodell anhand des Transkripts, ob die Condition erfuellt ist. Die Condition braucht **messbare, im Transkript pruefbare End-Bedingungen**. Formuliere sie genau nach diesem Schema (Single-Line, max ~3500 Zeichen, fertig zum Absenden):

```
/goal {{ISSUE_PREFIX}}-XXX Plan komplett umgesetzt: alle Implementation-Schritte aus dem ## Plan-Block der Issue-Description erledigt, {{BUILD_CHECKS}} exit 0, alle Acceptance-Criteria-Boxen in der ## Acceptance Criteria-Sektion via mcp__plugin_linear_linear__save_issue auf `- [x]` getoggelt, PR gegen {{BASE_BRANCH}} erstellt (Titel: "{{ISSUE_PREFIX}}-XXX - <titel>"), 3-fach-Ensemble-Review (3 parallele Review-Subagents in EINER message, broad scope) ausgefuehrt mit Konsens-Synthese und Folge-Commits fuer Konsens-Findings, Re-Review-Loop bei groesseren Aenderungen (Schwellwert: neue Logik / High-Risk / >50 LOC / >3 neue Files / Interface-Change, max 3 Runden), VOR `gh pr merge` alle DoD-Boxen in der ## Definition of Done-Sektion via save_issue auf `- [x]` getoggelt und ## Final Summary-Sektion mit Merge-SHA-Platzhalter und PR-Nummer gesetzt sowie state="In Review", Auto-Merge via `gh pr merge <N> --squash --delete-branch` nur wenn alle Gates gruen (Base={{BASE_BRANCH}}, Build exit 0, DoD-Boxen alle abgehakt, keine offenen [3/3]/[2/3]-Critical-Findings, Re-Review-Loop abgeschlossen, kein User-Override), PFLICHT-SCHRITT nach erfolgreichem Merge: `git checkout {{BASE_BRANCH}} && git pull --ff-only` ausfuehren und in einer User-Message bestaetigen dass der lokale {{BASE_BRANCH}}-Branch jetzt auf dem post-merge HEAD steht - dieser Schritt darf NICHT uebersprungen werden, und ALS LETZTER SCHRITT VOR LOOP-EXIT explizit mcp__plugin_linear_linear__save_issue id="{{ISSUE_PREFIX}}-XXX" state="Done" plus description-Patch mit echter Merge-SHA in ## Final Summary (Loop darf NICHT vorher stoppen, auch wenn alles andere fertig wirkt). Constraints: kein --no-verify, kein Hook-Bypass, kein Push auf protected Branches, kein Force-Push, {{EXTRA_CONSTRAINTS}}, keine Files ausserhalb der Plan-Touch-Points. Stoppe nach 40 turns falls nicht erfuellt.
```

Wenn das Issue einen **High-Risk-Bereich** ({{HIGH_RISK_AREAS}}) anfasst, ergaenze in den Constraints: `kleinere Commits, Zwischen-Verifikation nach jeder destruktiven Datenoperation`.

Wenn ein `single-writer:<bereich>`-Label aktiv ist, ergaenze: `kein paralleler Edit an <bereich>-Hot-Files solange anderes Issue In Progress`.

## Schritt 8 - ExitPlanMode

Praesentiere via `ExitPlanMode` eine kompakte Uebersicht:

- Worktree-Pfad + Branch
- Demo-Daten-Entscheidung (1 Satz, falls anwendbar)
- Anzahl Implementierungs-Schritte
- Hauptrisiken (max. 2 Bullets)
- **Den fertig formulierten `/goal`-Befehl aus Schritt 7 in einem eigenen Code-Block** (copy-paste-bereit)
- Hinweis: "Plan ist im Linear-Issue gespeichert (## Plan-Block der Description). Nach Approval bitte den `/goal`-Befehl absenden."

## Schritt 9 - Nach Plan-Approval (neuer Turn)

Sobald der User den Plan freigibt und der naechste Turn beginnt: **KEINE eigene Code-Arbeit starten.** Antworte stattdessen mit genau dieser Struktur:

```
Plan approved. Bitte den autonomen Loop starten:

/goal <condition aus Schritt 7>

(In die Chat-Zeile, mit Enter.)
```

Warte auf den `/goal`-Befehl des Users. Erst wenn dieser kommt, beginnt die Implementierung - und dann **nicht durch diesen Slash-Command**, sondern durch den offiziellen `/goal`-Loop.

**Begruendung**: `/goal` kann technisch nicht aus einem Slash-Command heraus getriggert werden. Der `/goal`-Loop hat Vorteile gegenueber einem DIY-Continue: per-turn Completion-Check, automatisches Stop bei Bounding-Clause, robust gegen Zwischen-Fehler, in `--resume` wiederherstellbar.

## Harte Regeln

- In Schritten 1-9: KEINE Code-Aenderungen, KEIN Demo-Daten-Run, KEIN Commit/Push/PR. Die Implementierung passiert ausschliesslich im darauffolgenden `/goal`-Loop.
- Destruktive Setup-Kommandos ({{DEMO_DATA_CMD}}) nur nach expliziter User-Bestaetigung.
- Bei `single-writer:<bereich>`-Label: vor Schritt 7 nochmal konkurrierende `In Progress`-Issues pruefen, bei Konflikt User fragen.
- Die Goal-Condition muss **messbar im Transkript** sein - keine Bedingungen wie "Code ist sauber".
- Alle Description-Patches via `save_issue` mit komplettem `description`-Body: erst `get_issue` lesen, gezielt patchen, zurueckschreiben.
- Pro Worktree maximal ein aktives `/goal`.
