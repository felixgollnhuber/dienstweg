import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLI_VERSION, STATE_DIR, MARKER_BEGIN } from "./config.mjs";
import { generatedFiles } from "./generate.mjs";

// Inspects a PreToolUse array (Claude settings.json or Codex hooks.json) for
// foreign entries that are not the branch-guard, returning a finding string or
// null. Shared by the Claude and Codex collision checks below.
function foreignHooksFinding(pre, label) {
  if (pre !== undefined && !Array.isArray(pre)) {
    return `${label} has hooks.PreToolUse in an unexpected shape (not an array) - the branch-guard hook was NOT wired; fix the file.`;
  }
  const foreign = (pre || []).filter(
    (entry) => !(entry?.hooks || []).some((h) => (h?.command || "").includes("branch-guard.mjs")),
  );
  if (foreign.length) {
    return `${label} has ${foreign.length} pre-existing PreToolUse hook entr${foreign.length === 1 ? "y" : "ies"} - verify they do not conflict with the branch-guard (e.g. duplicate git-rule enforcement with different rules).`;
  }
  return null;
}

// Mechanical findings the CLI can detect without semantic understanding, scoped
// to the harnesses being installed. Everything that needs judgment goes into the
// onboarding prompt for an agent.
export function collectFindings(root, harnesses) {
  const findings = [];
  const active = Array.isArray(harnesses) && harnesses.length ? harnesses : ["claude"];

  for (const spec of generatedFiles(active)) {
    const p = join(root, spec.target);
    if (existsSync(p)) {
      findings.push(`Pre-existing file at ${spec.target} - dienstweg did NOT overwrite it. Compare it with the dienstweg version and decide which one wins (adopt via \`dienstweg update --force\` or keep yours and remove it from dienstweg's scope).`);
    }
  }

  if (active.includes("claude")) {
    const settingsPath = join(root, ".claude", "settings.json");
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
        const finding = foreignHooksFinding(settings?.hooks?.PreToolUse, "settings.json");
        if (finding) findings.push(finding);
      } catch {
        findings.push("settings.json exists but could not be parsed as JSON - fix it manually; the branch-guard hook was NOT wired.");
      }
    }
  }

  if (active.includes("codex")) {
    const codexHooksPath = join(root, ".codex", "hooks.json");
    if (existsSync(codexHooksPath)) {
      try {
        const hooks = JSON.parse(readFileSync(codexHooksPath, "utf8"));
        const finding = foreignHooksFinding(hooks?.hooks?.PreToolUse, ".codex/hooks.json");
        if (finding) findings.push(finding);
      } catch {
        findings.push(".codex/hooks.json exists but could not be parsed as JSON - fix it manually; the branch-guard hook was NOT wired.");
      }
    }
    if (existsSync(join(root, ".codex", "config.toml"))) {
      findings.push(".codex/config.toml exists - check it for an inline [hooks] table or an approval_policy/sandbox setting that conflicts with the dienstweg branch-guard (the guard is wired via .codex/hooks.json, not config.toml).");
    }
  }

  const claudePath = join(root, "CLAUDE.md");
  if (existsSync(claudePath) && !readFileSync(claudePath, "utf8").includes("@AGENTS.md")) {
    findings.push("CLAUDE.md exists and does not import @AGENTS.md - the dienstweg workflow section lives in AGENTS.md, so either add an `@AGENTS.md` line to CLAUDE.md or move its content.");
  }

  const agentsPath = join(root, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const content = readFileSync(agentsPath, "utf8");
    if (!content.includes(MARKER_BEGIN)) {
      findings.push("AGENTS.md existed before dienstweg - the workflow block was appended at the end; check for contradicting instructions above it.");
    }
  }

  const workflowsDir = join(root, ".github", "workflows");
  if (existsSync(workflowsDir)) {
    const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    if (files.length) {
      findings.push(`CI workflows present (${files.join(", ")}) - check branch filters and required checks against the configured base branch.`);
    }
  }

  for (const f of ["CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md", ".husky"]) {
    if (existsSync(join(root, f))) {
      findings.push(`${f} exists - check it for workflow rules that contradict dienstweg (PR base, commit format, review process).`);
    }
  }

  return findings;
}

export function buildOnboardingPrompt(config, findings) {
  const f = findings.length
    ? findings.map((x) => `- ${x}`).join("\n")
    : "- none - the mechanical scan found no collisions.";
  const harnesses = Array.isArray(config.harnesses) && config.harnesses.length ? config.harnesses : ["claude"];
  const surfaceLines = [];
  if (harnesses.includes("claude")) {
    surfaceLines.push("- `.claude/commands/create-issue.md` + `.claude/commands/start-task.md` - Claude Code slash-commands that read the config at runtime.");
    surfaceLines.push("- `.claude/hooks/branch-guard.mjs` (wired via .claude/settings.json) - blocks pushes/PRs that violate the git rules.");
  }
  if (harnesses.includes("codex")) {
    surfaceLines.push("- `.agents/skills/create-issue/SKILL.md` + `.agents/skills/start-task/SKILL.md` - repo-committed Codex skills that read the config at runtime.");
    surfaceLines.push("- `.codex/hooks/branch-guard.mjs` (wired via .codex/hooks.json) - blocks pushes/PRs that violate the git rules.");
  }
  const surface = surfaceLines.join("\n");
  return `# dienstweg onboarding audit

You are onboarding this repository onto the dienstweg task workflow (v${CLI_VERSION}). The CLI already did the mechanical setup. Your job is the semantic part: find and resolve contradictions between the project's existing rules and the dienstweg workflow, then verify the setup.

Respond to the user in "${config.language}".

## What dienstweg installed

- \`dienstweg.config.json\` - the single source of project values: Linear team "${config.tracker.linearTeam}", issue prefix ${config.tracker.issuePrefix}, base branch \`${config.git.baseBranch}\`, gates \`${config.gates.build}\`, harnesses ${harnesses.join(" + ")}.
${surface}
- A "Task workflow (dienstweg)" block in AGENTS.md between \`<!-- dienstweg:begin -->\` and \`<!-- dienstweg:end -->\` markers (read natively by both Claude Code and Codex).
- \`dienstweg.local.md\` - the place for project-specific additions (owned by the project, never overwritten).

## Mechanical findings from the CLI

${f}

## Your tasks

1. Read \`dienstweg.config.json\`, AGENTS.md (the dienstweg block AND everything else), CLAUDE.md, dienstweg.local.md, CONTRIBUTING.md, .github/ (workflows, PR templates), any pre-existing command/skill/hook files under .claude/, .codex/, and .agents/skills/.
2. Build a conflict report: every place where an existing rule contradicts the dienstweg workflow (examples: different PR base branch, different commit format, a competing review process, another issue tracker, hooks enforcing different rules). For each finding propose exactly one resolution:
   - dienstweg wins: remove/adjust the old rule.
   - project wins: encode the project rule in dienstweg.config.json (extraDoD, extraConstraints, areas, gates) or dienstweg.local.md.
   - user decides: present the trade-off and ask.
3. Present the report to the user BEFORE changing anything. Apply the agreed resolutions.
4. Verify: run \`dienstweg check\` from the repo root and fix whatever it reports until it passes.
5. Summarize what changed and what the user still has to do manually (e.g. create the Linear team "${config.tracker.linearTeam}" with key ${config.tracker.issuePrefix} and labels \`parallel-safe\` + \`single-writer:<area>\` if they do not exist yet).

Do not start implementing feature work. This session is only about workflow onboarding.`;
}

export function writeOnboardingPrompt(root, prompt) {
  const dir = join(root, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "onboarding-prompt.md");
  writeFileSync(p, prompt + "\n");
  return p;
}
