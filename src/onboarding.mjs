import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLI_VERSION, STATE_DIR, MARKER_BEGIN } from "./config.mjs";
import { GENERATED_FILES } from "./generate.mjs";

// Mechanical findings the CLI can detect without semantic understanding.
// Everything that needs judgment goes into the onboarding prompt for an agent.
export function collectFindings(root) {
  const findings = [];

  for (const spec of GENERATED_FILES) {
    const p = join(root, spec.target);
    if (existsSync(p)) {
      findings.push(`Pre-existing file at ${spec.target} - dienstweg did NOT overwrite it. Compare it with the dienstweg version and decide which one wins (adopt via \`npx dienstweg update --force\` or keep yours and remove it from dienstweg's scope).`);
    }
  }

  const settingsPath = join(root, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const pre = settings?.hooks?.PreToolUse || [];
      const foreign = pre.filter(
        (entry) => !(entry.hooks || []).some((h) => (h.command || "").includes("branch-guard.mjs")),
      );
      if (foreign.length) {
        findings.push(`settings.json has ${foreign.length} pre-existing PreToolUse hook entr${foreign.length === 1 ? "y" : "ies"} - verify they do not conflict with the branch-guard (e.g. duplicate git-rule enforcement with different rules).`);
      }
    } catch {
      findings.push("settings.json exists but could not be parsed as JSON - fix it manually; the branch-guard hook was NOT wired.");
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
  return `# dienstweg onboarding audit

You are onboarding this repository onto the dienstweg task workflow (v${CLI_VERSION}). The CLI already did the mechanical setup. Your job is the semantic part: find and resolve contradictions between the project's existing rules and the dienstweg workflow, then verify the setup.

Respond to the user in "${config.language}".

## What dienstweg installed

- \`dienstweg.config.json\` - the single source of project values: Linear team "${config.tracker.linearTeam}", issue prefix ${config.tracker.issuePrefix}, base branch \`${config.git.baseBranch}\`, gates \`${config.gates.build}\`.
- \`.claude/commands/create-issue.md\` + \`.claude/commands/start-task.md\` - generic commands that read the config at runtime.
- \`.claude/hooks/branch-guard.mjs\` (wired via settings.json) - blocks pushes/PRs that violate the git rules.
- A "Task workflow (dienstweg)" block in AGENTS.md between \`<!-- dienstweg:begin -->\` and \`<!-- dienstweg:end -->\` markers.
- \`dienstweg.local.md\` - the place for project-specific additions (owned by the project, never overwritten).

## Mechanical findings from the CLI

${f}

## Your tasks

1. Read \`dienstweg.config.json\`, AGENTS.md (the dienstweg block AND everything else), CLAUDE.md, dienstweg.local.md, CONTRIBUTING.md, .github/ (workflows, PR templates), any pre-existing .claude/commands and hooks.
2. Build a conflict report: every place where an existing rule contradicts the dienstweg workflow (examples: different PR base branch, different commit format, a competing review process, another issue tracker, hooks enforcing different rules). For each finding propose exactly one resolution:
   - dienstweg wins: remove/adjust the old rule.
   - project wins: encode the project rule in dienstweg.config.json (extraDoD, extraConstraints, areas, gates) or dienstweg.local.md.
   - user decides: present the trade-off and ask.
3. Present the report to the user BEFORE changing anything. Apply the agreed resolutions.
4. Verify: run \`npx dienstweg check\` from the repo root and fix whatever it reports until it passes.
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
