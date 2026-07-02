import { CLI_VERSION } from "./config.mjs";
import { runInit } from "./init.mjs";
import { runUpdate } from "./update.mjs";
import { runCheck } from "./check.mjs";

const HELP = `dienstweg v${CLI_VERSION} - config-driven task workflow for agent-assisted development

Usage: dienstweg <command> [flags]

Commands:
  init      Set up dienstweg in the current repo (interactive interview).
  update    Regenerate tool-owned files, run config migrations, bump version stamp.
  check     Verify the setup (config, generated files, hook wiring, AGENTS block).
  version   Print the CLI version.
  help      Show this help.

init flags (each skips the corresponding question):
  --yes                 Non-interactive: use defaults for everything not passed as a flag.
  --new | --existing    Fresh repo vs. existing project (default: auto-detected).
  --name <name>         Project name.
  --language <lang>     Conversation language (default: en).
  --prefix <KEY>        Linear issue prefix / team key.
  --team <name>         Linear team name.
  --project <name>      Default Linear project (default: none).
  --base <branch>       Base branch for PRs (default: main).
  --gates <cmd>         Build/test gate command (default: npm run build && npm test).
  --high-risk <a,b>     High-risk areas, comma-separated.
  --single-writer <a,b> Single-writer areas, comma-separated.

update flags:
  --force               Overwrite hand-edited generated files.

Run from the target repo's root. Docs: WORKFLOW.md in the dienstweg repo.`;

const VALUE_FLAGS = {
  "--name": "name",
  "--language": "language",
  "--prefix": "prefix",
  "--team": "team",
  "--project": "project",
  "--base": "base",
  "--gates": "gates",
  "--high-risk": "highRisk",
  "--single-writer": "singleWriter",
};

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yes") flags.yes = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--new") flags.existing = false;
    else if (arg === "--existing") flags.existing = true;
    else if (VALUE_FLAGS[arg]) {
      const value = args[++i];
      if (value === undefined) throw new Error(`flag ${arg} needs a value`);
      flags[VALUE_FLAGS[arg]] = value;
    } else {
      throw new Error(`unknown flag: ${arg} (see \`dienstweg help\`)`);
    }
  }
  return flags;
}

export async function run(argv) {
  const [command, ...rest] = argv;
  const root = process.cwd();

  switch (command) {
    case "init":
      process.exitCode = await runInit(root, parseFlags(rest));
      break;
    case "update":
      process.exitCode = runUpdate(root, parseFlags(rest));
      break;
    case "check":
      process.exitCode = runCheck(root);
      break;
    case "version":
      console.log(CLI_VERSION);
      break;
    case "help":
    case undefined:
      console.log(HELP);
      break;
    default:
      throw new Error(`unknown command: ${command} (see \`dienstweg help\`)`);
  }
}
