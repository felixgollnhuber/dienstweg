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
  --auto-merge | --no-auto-merge
                        Merge PRs autonomously when all gates are green (default: on).
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
const BOOL_FLAGS = {
  "--yes": ["yes", true],
  "--force": ["force", true],
  "--new": ["existing", false],
  "--existing": ["existing", true],
  "--auto-merge": ["autoMerge", true],
  "--no-auto-merge": ["autoMerge", false],
};

const INIT_FLAGS = new Set([...Object.keys(VALUE_FLAGS), "--yes", "--new", "--existing", "--auto-merge", "--no-auto-merge"]);
const UPDATE_FLAGS = new Set(["--force"]);

function parseFlags(args, allowed) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!allowed.has(arg)) {
      throw new Error(`unknown or unsupported flag for this command: ${arg} (see \`dienstweg help\`)`);
    }
    if (BOOL_FLAGS[arg]) {
      const [key, value] = BOOL_FLAGS[arg];
      flags[key] = value;
    } else {
      const value = args[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`flag ${arg} needs a value (got: ${value ?? "nothing"})`);
      }
      flags[VALUE_FLAGS[arg]] = value;
    }
  }
  return flags;
}

function rejectArgs(command, rest) {
  if (rest.length) throw new Error(`\`dienstweg ${command}\` takes no arguments (got: ${rest.join(" ")})`);
}

export async function run(argv) {
  const [command, ...rest] = argv;
  const root = process.cwd();

  switch (command) {
    case "init":
      process.exitCode = await runInit(root, parseFlags(rest, INIT_FLAGS));
      break;
    case "update":
      process.exitCode = runUpdate(root, parseFlags(rest, UPDATE_FLAGS));
      break;
    case "check":
      rejectArgs("check", rest);
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
