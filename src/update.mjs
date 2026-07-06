import {
  CLI_VERSION,
  CURRENT_SCHEMA_VERSION,
  CONFIG_FILENAME,
  loadConfig,
  loadManifest,
  writeConfig,
  validateConfig,
  compareSemver,
} from "./config.mjs";
import {
  writeGeneratedFiles,
  writeManifest,
  renderAgentsBlock,
  upsertAgentsBlock,
  wireHooks,
} from "./generate.mjs";
import { migrations } from "../migrations/index.mjs";

export function runUpdate(root, flags) {
  const config = loadConfig(root);
  if (!config) {
    throw new Error("no dienstweg.config.json found - run `dienstweg init` first.");
  }
  if (compareSemver(config.dienstwegVersion, CLI_VERSION) > 0) {
    throw new Error(
      `project is on v${config.dienstwegVersion} but this CLI is v${CLI_VERSION} - update the dienstweg repo (git pull) first.`,
    );
  }
  if ((config.schemaVersion ?? 0) > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `config schemaVersion ${config.schemaVersion} is newer than this CLI supports (${CURRENT_SCHEMA_VERSION}) - update the dienstweg repo (git pull) first.`,
    );
  }

  // A missing/zero stamp means the config predates schema tracking (or a merge
  // dropped the field); treat it as the initial schema, which needs no migration.
  const startVersion = config.schemaVersion || 1;

  // Config schema migrations run first so generators see the current shape.
  const pending = migrations
    .filter((m) => m.toSchemaVersion > startVersion)
    .sort((a, b) => a.toSchemaVersion - b.toSchemaVersion);
  config.schemaVersion = startVersion;
  for (const migration of pending) {
    migration.migrate(config);
    config.schemaVersion = migration.toSchemaVersion;
    console.log(`migrated config to schema v${migration.toSchemaVersion}: ${migration.description}`);
  }
  if (config.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `no migration path to schema v${CURRENT_SCHEMA_VERSION} from v${startVersion} - this is a dienstweg bug (missing migration).`,
    );
  }

  // Validate before regenerating, so `update` never renders "undefined" into
  // the AGENTS block or the commands from a broken config.
  const problems = validateConfig(config);
  if (problems.length) {
    throw new Error(`config is invalid, refusing to regenerate:\n  - ${problems.join("\n  - ")}\nFix ${CONFIG_FILENAME} and re-run.`);
  }

  // The manifest is disposable, fully-regenerable state; a corrupt one must not
  // dead-end the very command the doctor points at for recovery. Treat it as
  // absent and regenerate.
  let previousManifest = null;
  try {
    previousManifest = loadManifest(root);
  } catch {
    console.log("  NOTE: .dienstweg/manifest.json was unreadable - regenerating it from scratch.");
  }
  const mode = flags.force ? "overwrite" : "skip";
  const { manifest, skipped } = writeGeneratedFiles(root, previousManifest, mode, config.harnesses);
  writeManifest(root, manifest);
  const hookResult = wireHooks(root, config.harnesses);
  const agentsActions = upsertAgentsBlock(root, renderAgentsBlock(config));

  const fromVersion = config.dienstwegVersion;
  // Only stamp the new version when regeneration was complete. If files were
  // skipped, the repo is not fully on the new version yet.
  if (skipped.length === 0) config.dienstwegVersion = CLI_VERSION;
  writeConfig(root, config);

  const toLabel = skipped.length === 0 ? `v${CLI_VERSION}` : `v${fromVersion} (incomplete)`;
  console.log(`dienstweg update: v${fromVersion} -> ${toLabel}`);
  for (const target of Object.keys(manifest.files)) {
    if (!skipped.includes(target)) console.log(`  regenerated: ${target}`);
  }
  for (const target of skipped) {
    console.log(`  CONFLICT:    ${target} is hand-edited or unmanaged - left untouched. Move customizations to ${CONFIG_FILENAME} / dienstweg.local.md, then re-run with --force.`);
  }
  for (const a of hookResult.actions) console.log(`  ${a.message}`);
  for (const a of agentsActions) console.log(`  ${a}`);
  if (pending.length) {
    console.log(`\nNOTE: ${pending.length} config migration(s) ran - review ${CONFIG_FILENAME} and commit the changes.`);
  }
  if (skipped.length) {
    console.log(`\nNOTE: version stamp left at v${fromVersion} until the ${skipped.length} conflict(s) are resolved (re-run with --force).`);
  }
  if (!hookResult.wired) {
    console.error(`\nWARN: the branch-guard hook is NOT wired - the git guardrail is inert until you fix the hook config and re-run.`);
  }
  return skipped.length || !hookResult.wired ? 1 : 0;
}
