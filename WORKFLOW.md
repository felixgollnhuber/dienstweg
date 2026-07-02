# Task-Workflow-Framework

Generisches Framework fuer agentengestuetzte Entwicklung mit Claude Code, Linear und GitHub. Alle projektspezifischen Werte sind `{{PLATZHALTER}}` - siehe Sektion "Adoption" am Ende.

## 1. Prinzipien

1. **Issue = Single Source of Truth.** Jeder Task ist ein Linear-Issue (`{{ISSUE_PREFIX}}-XXX`) mit vollstaendiger Description (Plan, AC, DoD, Setup, Final Summary). Kein lokales Backlog-File, kein Task-Wissen nur im Chat.
2. **Plan vor Code.** Kein Implementierungs-Commit, bevor der Plan im Issue steht und freigegeben ist. Non-negotiable.
3. **Messbare Gates statt Bauchgefuehl.** Build-/Test-Kommandos mit Exit-Code 0, abgehakte Checkboxen, existierende PRs - keine Bedingungen wie "Code ist sauber".
4. **Redundantes Review.** 3 unabhaengige Review-Subagents mit identischem, breitem Scope. Der Wert liegt im Ensemble: Konsens = hohe Prioritaet, Singleton = kritisch pruefen, Konflikte = explizit entscheiden.
5. **Autonomer Merge mit harten Gates.** Ist der Review-Loop sauber abgeschlossen, wird ohne Rueckfrage gemergt - aber nur, wenn ALLE Gates gruen sind. Ein User-Override ("merge nicht automatisch") gilt fuer die ganze Session.
6. **Maschinelle Regel-Durchsetzung.** Git-Konventionen werden nicht nur dokumentiert, sondern per PreToolUse-Hook (branch-guard) erzwungen.
7. **Scope-Disziplin.** Scope-Erweiterungen nie stillschweigend - User fragen oder Folge-Issue anlegen.

## 2. Issue-Schema (Description-Template, Pflicht fuer jedes Issue)

```markdown
## Plan
<vor Code-Arbeit gesetzt, via /start-task>

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

## Final Summary
<vor State=Done gesetzt: Merge-SHA, PR-Nummer, Review-Runden, Folge-Issues>
```

## 3. Git-Konventionen

- Base-Branch fuer alle PRs: `{{BASE_BRANCH}}`. Direkte Pushes auf protected Branches sind verboten (Guard-Hook).
- Feature-Branch: `tasks/{{issue_prefix_lower}}-XXX-<kurz-slug>` (Issue-Identifier kleingeschrieben, Slug aus dem Titel, kebab-case).
- Commit: `{{ISSUE_PREFIX}}-XXX - Kurzbeschreibung`.
- PR-Titel: `{{ISSUE_PREFIX}}-XXX - Task-Titel`, PR-Base immer `{{BASE_BRANCH}}` (explizit setzen).
- Merge: `gh pr merge <N> --squash --delete-branch`.
- Reine Tooling-/Infra-Aenderungen ohne Issue duerfen einen `tasks/<kurz-slug>`-Branch ohne Prefix nutzen; sobald ein Issue existiert, gilt das Prefix-Schema.
- Kein `git commit --no-verify`, kein Force-Push auf shared Branches (Guard-Hook blockt beides).

## 4. Parallelitaets-Labels

Pro Issue genau eines:

- `parallel-safe` - kollidiert mit nichts, kann jederzeit parallel laufen.
- `single-writer:<bereich>` - exklusiver Lock auf einen Hot-Bereich ({{SINGLE_WRITER_AREAS}}). Vor Start pruefen: `list_issues label="single-writer:<bereich>" state="In Progress"` - bei Treffer warten oder User fragen.

Im Zweifel `single-writer:<bereich>` setzen statt faelschlich `parallel-safe`.

## 5. Task-Lifecycle

1. **Issue-Claim**: `save_issue id="{{ISSUE_PREFIX}}-XXX" state="In Progress" assignee="me"`.
2. **Plan VOR Code** in die Issue-Description (Sektion `## Plan`) via `save_issue`. Erfolgt strukturiert durch `/start-task`.
3. **Waehrend der Arbeit**: AC-Checkboxen via Description-Patch abhaken; Notes als Comments (`save_comment`); Plan-Updates via erneutem `save_issue`.
4. **Scope-Erweiterungen**: User fragen oder Folge-Issue anlegen - nie stillschweigend.
5. **Backlog-Disziplin VOR dem Merge** (sonst geht der Update verloren, weil `--delete-branch` den Branch loescht): alle AC- und DoD-Boxen abhaken, `## Final Summary` mit Merge-SHA-Platzhalter + PR-Nummer schreiben, `state="In Review"` setzen. Diese Aenderungen als letzter Commit auf dem Feature-Branch.
6. **3-fach-Ensemble-Review** (Sektion 6) inkl. direkter Fix-Umsetzung und ggf. Re-Review-Runden.
7. **Auto-Merge** (Sektion 7) inkl. Pflicht-Schritt Post-Merge-Sync.
8. **Abschluss**: `save_issue state="Done"` + `## Final Summary` finalisieren (echte Merge-SHA, Review-Runden, Folge-Issues).

## 6. 3-fach-Ensemble-Review (Pflicht vor jedem Merge)

- **3 parallele Review-Subagents** in EINER Message starten (echte Parallelitaet). `subagent_type=ensemble-reviewer`, falls im Projekt definiert; Fallback `general-purpose`.
- **Kein Scope-Split**: alle 3 reviewen den vollstaendigen PR mit demselben breiten Scope (Code-Quality, Bugs, Logik, Konventionen, Tests, Edge-Cases, Error-Handling, Security, High-Risk-Bereiche, Performance). Absichtlich redundant.
- Jeder Subagent bekommt PR-Nummer + Branch + Worktree-Pfad + identischen Prompt; Output: strukturierter Report (Critical / Important / Suggestions / Strengths) mit `file:line`-Referenzen.
- **Synthese durch den Main-Agent**: Konsens-Findings (>=2 Agents) direkt fixen; Singletons kritisch bewerten (echtes Issue trotzdem fixen); Konflikte explizit ausweisen und entscheiden, nicht stillschweigend mitteln.
- **Fixes als Folge-Commits** auf demselben Branch. Groessere Refactors/Scope-Erweiterungen als Folge-Issue.
- **Re-Review-Pflicht** bei groesseren Fix-Aenderungen, komplett neu, bis eine Runde ohne groessere Folge-Aenderungen endet (max. 3 Runden, danach Folge-Issue fuer Offenes). Schwellwert (oder-verknuepft): neue Logik (Funktion/Klasse/Route/Migration), Aenderung in High-Risk-Bereichen ({{HIGH_RISK_AREAS}}), >50 LOC netto seit letztem Review, >3 neue Dateien ausserhalb des Original-Diffs, Aenderung an oeffentlichen Interfaces. Reine Kosmetik (Typos, Imports, Formatting) loest kein Re-Review aus. Im Zweifel: re-reviewen.
- Pro Re-Review-Runde im Final Summary vermerken: "Re-Review-Runde N (Trigger: <grund>), Findings: <count>".
- "Merge-ready" ohne Ensemble-Review oder ohne Umsetzung direkt fixbarer Findings zaehlt als unvollstaendige Arbeit. Ein einzelner Review-Aufruf ersetzt das Ensemble nicht.
- Hinweis Worktree-Hygiene: parallele Reviewer im selben Worktree koennen Artefakte hinterlassen - nach dem Review `git status` pruefen, Fremd-Dateien via `git checkout HEAD -- <files>` entfernen, bevor Fix-Commits entstehen.

## 7. Auto-Merge (Default) + Gates

Ist der Review-Loop sauber abgeschlossen, wird **autonom gemergt** - kein "Soll ich mergen?". Befehl: `gh pr merge <N> --squash --delete-branch`. Output mit Merge-SHA + PR-URL.

**Pflicht-Schritt direkt nach erfolgreichem Merge** (nie ueberspringen):

```
git checkout {{BASE_BRANCH}} && git pull --ff-only
```

Begruendung: der lokale Base-Branch muss nach jedem Merge auf den neuen HEAD, sonst startet das naechste `/start-task` auf veraltetem Stand. Pull-Erfolg (neuer HEAD-SHA) in einer User-Message bestaetigen, bevor `state="Done"` gesetzt wird.

**Auto-Merge-Gates** (alle muessen erfuellt sein):

- PR-Base ist `{{BASE_BRANCH}}`.
- {{BUILD_CHECKS}} exit 0 nach den letzten Fix-Commits (Exit-Code direkt pruefen, nicht durch Pipes maskieren).
- **DoD-Gate**: vor Merge per `get_issue` die Description ziehen und auf offene `- [ ]`-Boxen in `## Definition of Done` pruefen. Offene Boxen -> kein Auto-Merge, klare Meldung an den User.
- Letzte Review-Runde ohne offene [3/3]- oder [2/3]-Critical-Findings.
- Re-Review-Loop abgeschlossen (oder Max-3-Runden erreicht und Rest als Folge-Issue ausgewiesen).
- Kein User-Override aktiv ("merge nicht automatisch", "ich review selbst" o.ae. - gilt fuer die ganze Session).

Bei verletztem Gate: NICHT mergen, Status-Report mit Begruendung und Vorschlag (manueller Review, Folge-Issue, etc.).

## 8. /goal-Condition-Schema

`/start-task` endet mit einer copy-paste-fertigen `/goal`-Condition. Der `/goal`-Loop (Claude Code v2.1.139+) prueft nach jedem Turn per Kleinmodell, ob die Condition erfuellt ist - sie braucht daher **messbare, im Transkript pruefbare End-Bedingungen**. Schema (Single-Line, auf Projektsprache):

```
/goal {{ISSUE_PREFIX}}-XXX Plan komplett umgesetzt: alle Implementation-Schritte aus dem ## Plan-Block der Issue-Description erledigt, {{BUILD_CHECKS}} exit 0, alle Acceptance-Criteria-Boxen via save_issue auf `- [x]` getoggelt, PR gegen {{BASE_BRANCH}} erstellt (Titel: "{{ISSUE_PREFIX}}-XXX - <titel>"), 3-fach-Ensemble-Review (3 parallele Review-Subagents in EINER message, broad scope) ausgefuehrt mit Konsens-Synthese und Folge-Commits fuer Konsens-Findings, Re-Review-Loop bei groesseren Aenderungen (Schwellwert: neue Logik / High-Risk / >50 LOC / >3 neue Files / Interface-Change, max 3 Runden), VOR `gh pr merge` alle DoD-Boxen via save_issue auf `- [x]` getoggelt und ## Final Summary mit Merge-SHA-Platzhalter + PR-Nummer gesetzt sowie state="In Review", Auto-Merge via `gh pr merge <N> --squash --delete-branch` nur wenn alle Gates gruen (Base={{BASE_BRANCH}}, Build exit 0, DoD-Boxen abgehakt, keine offenen [3/3]/[2/3]-Critical-Findings, Re-Review-Loop abgeschlossen, kein User-Override), PFLICHT-SCHRITT nach erfolgreichem Merge: `git checkout {{BASE_BRANCH}} && git pull --ff-only` ausfuehren und in einer User-Message den neuen HEAD bestaetigen, ALS LETZTER SCHRITT VOR LOOP-EXIT save_issue state="Done" plus description-Patch mit echter Merge-SHA in ## Final Summary. Constraints: kein --no-verify, kein Hook-Bypass, kein Push auf protected Branches, kein Force-Push, {{EXTRA_CONSTRAINTS}}, keine Files ausserhalb der Plan-Touch-Points. Stoppe nach 40 turns falls nicht erfuellt.
```

Bei High-Risk-Issues ergaenzen: `kleinere Commits, Zwischen-Verifikation nach jeder destruktiven Datenoperation`. Bei aktivem `single-writer:<bereich>`-Label ergaenzen: `kein paralleler Edit an <bereich>-Hot-Files solange anderes Issue In Progress`.

## 9. Worktrees

- Ein Worktree pro Task: `.claude/worktrees/tasks+{{issue_prefix_lower}}-XXX-<slug>` auf Branch `tasks/{{issue_prefix_lower}}-XXX-<slug>` aus `{{BASE_BRANCH}}`.
- Anlage: projekteigenes Helper-Script ({{WORKTREE_HELPER}}), falls vorhanden; sonst plain `git worktree add .claude/worktrees/tasks+<...> -b tasks/<...> {{BASE_BRANCH}}` gefolgt von {{SETUP_CMD}}.
- Pro Worktree maximal ein aktives `/goal`.
- Cleanup nach Merge: `git worktree remove <pfad>`; Remote-Branch loescht der Merge (`--delete-branch`). Der Fehler "X is already used by worktree" beim --delete-branch ist KEIN Merge-Fehlschlag - Remote-Merge ok, lokal Worktree entfernen und ff-only-Pull im Main-Checkout.

## 10. Adoption

Platzhalter-Tabelle (alle Vorkommen in `templates/` ersetzen):

| Platzhalter | Bedeutung | Beispiel (factotum) |
|---|---|---|
| `{{ISSUE_PREFIX}}` | Linear-Team-Key | `FAC` |
| `{{issue_prefix_lower}}` | Prefix kleingeschrieben (Branches) | `fac` |
| `{{LINEAR_TEAM}}` | Linear-Team-Name | `Factotum` |
| `{{DEFAULT_PROJECT}}` | Default-Linear-Project oder `-` (Team-Backlog) | `-` |
| `{{BASE_BRANCH}}` | PR-Base-Branch | `main` |
| `{{BUILD_CHECKS}}` | Build-/Test-Gates | `npm run build && npm test` |
| `{{SETUP_CMD}}` | Worktree-Setup | `npm ci` |
| `{{WORKTREE_HELPER}}` | Helper-Script oder `-` (plain git worktree) | `-` |
| `{{HIGH_RISK_AREAS}}` | Bereiche mit verschaerften Gates | siehe factotum |
| `{{SINGLE_WRITER_AREAS}}` | Bereiche fuer single-writer-Labels | `manifest-format, index-schema, mcp-api, parser` |
| `{{DEMO_DATA_CMD}}` | destruktives Demo-Daten-Kommando oder `-` | `-` |
| `{{PROJECT_EXTRA_DOD}}` | zusaetzliche DoD-Zeilen | siehe factotum |
| `{{EXTRA_CONSTRAINTS}}` | projektspezifische /goal-Constraints | siehe factotum |

Schritte:

1. Linear-Team `{{LINEAR_TEAM}}` anlegen (Key = `{{ISSUE_PREFIX}}`), Labels `parallel-safe` + `single-writer:<bereich>` fuer jede Area aus `{{SINGLE_WRITER_AREAS}}` erstellen.
2. `templates/commands/*.md` nach `<projekt>/.claude/commands/` kopieren, Platzhalter ersetzen.
3. `templates/hooks/branch-guard.mjs` nach `<projekt>/.claude/hooks/` kopieren, `CONFIG` anpassen, via `templates/settings-hook-snippet.json` in `.claude/settings.json` verdrahten.
4. `templates/AGENTS-task-lifecycle.md` (Platzhalter ersetzt) als Sektion in die Projekt-AGENTS.md uebernehmen.
5. Optional: `ensemble-reviewer`-Subagent unter `.claude/agents/` definieren.
6. Description-Template (Sektion 2) als Linear-Team-Template hinterlegen (optional, Commands erzwingen es ohnehin).
