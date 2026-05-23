// Shared types for migration steps. Kept in their own module so
// individual step files can import the types without pulling in
// the step registry (which would create a cycle: steps.ts imports
// each step, each step imports the types).

export interface ConfigMigrationStepApplyArgs {
  text: string;
}

export interface ConfigMigrationStepApplyResult {
  // The text after the step's rewrite. Equal to the input when no
  // change applied — the runner uses an empty `changes` list as
  // the canonical "did nothing" signal.
  rewrittenText: string;
  changes: MigrationChange[];
}

// One discrete change a migration step made. Steps describe their
// rewrites as a list of these so consumers (the CLI's human
// renderer, the --json envelope, automation tools) can summarize
// what happened without re-diffing the text.
export interface MigrationChange {
  // Dotted breadcrumb identifying the location within the config,
  // e.g. "discovery.plugins[0].use" or "publishing.plugin". Stays
  // stable across migration releases for the same logical field.
  path: string;
  // The original string value (or short summary) the user had.
  before: string;
  // What the step replaced it with — kind + value pair captures
  // the most common shape (a discriminated reference) without
  // committing to a specific schema. Future steps can use the
  // same shape ("kind" = "deprecated-key" / "value" = the new
  // key, etc.) without changing this type.
  kind: string;
  value: string;
}
