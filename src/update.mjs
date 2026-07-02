import {
  CLI_VERSION,
  CURRENT_SCHEMA_VERSION,
  loadConfig,
  loadManifest,
  writeConfig,
  compareSemver,
} from "./config.mjs";
import {
  writeGeneratedFiles,
  writeManifest,
  renderAgentsBlock,
  upsertAgentsBlock,
  ensureLocalRules,
  mergeSettings,
} from "./generate.mjs";
import { migrations } from "../migrations/index.mjs";

export function runUpdate(root, flags) {
  const config = loadConfig(root);
  if (!config) {
    throw new Error("no dienstweg.config.json found - run `npx dienstweg init` first.");
  }
  if (compareSemver(config.dienstwegVersion, CLI_VERSION) > 0) {
    throw new Error(
      `project is on v${config.dienstwegVersion} but this CLI is v${CLI_VERSION} - update the dienstweg repo (git pull) first.`,
    );
  }

  // Config schema migrations run first so generators see the current shape.
  const pending = migrations
    .filter((m) => m.toSchemaVersion > (config.schemaVersion ?? 0))
    .sort((a, b) => a.toSchemaVersion - b.toSchemaVersion);
  for (const migration of pending) {
    migration.migrate(config);
    config.schemaVersion = migration.toSchemaVersion;
    console.log(`migrated config to schema v${migration.toSchemaVersion}: ${migration.description}`);
  }
  if (config.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    config.schemaVersion = CURRENT_SCHEMA_VERSION;
  }

  const previousManifest = loadManifest(root);
  const mode = flags.force ? "overwrite" : "skip";
  const { manifest, skipped } = writeGeneratedFiles(root, previousManifest, mode);
  writeManifest(root, manifest);
  const settingsAction = mergeSettings(root);
  const agentsActions = upsertAgentsBlock(root, renderAgentsBlock(config));
  ensureLocalRules(root);

  const fromVersion = config.dienstwegVersion;
  config.dienstwegVersion = CLI_VERSION;
  writeConfig(root, config);

  console.log(`dienstweg update: v${fromVersion} -> v${CLI_VERSION}`);
  for (const target of Object.keys(manifest.files)) {
    if (!skipped.includes(target)) console.log(`  regenerated: ${target}`);
  }
  for (const target of skipped) {
    console.log(`  CONFLICT:    ${target} was hand-edited - left untouched. Move customizations to dienstweg.config.json / dienstweg.local.md, then re-run with --force.`);
  }
  console.log(`  ${settingsAction}`);
  for (const a of agentsActions) console.log(`  ${a}`);
  if (pending.length) {
    console.log(`\nNOTE: ${pending.length} config migration(s) ran - review dienstweg.config.json and commit the changes.`);
  }
  return skipped.length ? 1 : 0;
}
