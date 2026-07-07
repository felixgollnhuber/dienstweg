// Config schema migrations. Each entry upgrades a dienstweg.config.json object
// in place from schemaVersion (toSchemaVersion - 1) to toSchemaVersion.
// `dienstweg update` applies pending migrations in ascending order before
// regenerating files. Keep migrations idempotent and side-effect free. Inline
// literal defaults here - never import evolving constants (e.g. DEFAULT_STANCES)
// so a historical migration always yields its own schema's shape.
//
// Example:
// {
//   toSchemaVersion: 2,
//   description: "rename gates.build to gates.verify",
//   migrate(config) {
//     config.gates.verify ??= config.gates.build;
//     delete config.gates.build;
//   },
// }

export const migrations = [
  {
    toSchemaVersion: 2,
    description: "add merge.auto - autonomous-merge switch (true preserves the previous behavior)",
    migrate(config) {
      config.merge ??= {};
      config.merge.auto ??= true;
    },
  },
  {
    toSchemaVersion: 3,
    description: "add harnesses - install for both Claude Code and Codex (existing repos gain Codex on update)",
    migrate(config) {
      config.harnesses ??= ["claude", "codex"];
    },
  },
  {
    toSchemaVersion: 4,
    description: "add review.stances - decorrelate the ensemble via distinct reviewer stances (existing configs gain the defaults)",
    migrate(config) {
      config.review ??= {};
      config.review.stances ??= ["adversarial", "spec-conformance", "maintainer"];
    },
  },
];
