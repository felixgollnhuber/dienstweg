// Config schema migrations. Each entry upgrades a dienstweg.config.json object
// in place from schemaVersion (toSchemaVersion - 1) to toSchemaVersion.
// `dienstweg update` applies pending migrations in ascending order before
// regenerating files. Keep migrations idempotent and side-effect free.
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

export const migrations = [];
