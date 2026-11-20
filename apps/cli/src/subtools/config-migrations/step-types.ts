// Shared types for migration steps. Kept in their own module so
// individual step files can import the types without pulling in
// the step registry (which would create a cycle: steps.ts imports
// each step, each step imports the types).

/** One registered config migration step (see steps.ts). */
export interface ConfigMigrationStep {
  /**
   * Stable identifier, kebab-case. Used in `--json` output and in human
   * summaries so users can correlate a change to its step.
   */
  id: string;
  /** One-line human description, used by the CLI's summary. */
  description: string;
  /**
   * Pure function: text in, text + change-list out. A step with nothing
   * to rewrite returns `changes: []` and the text unchanged.
   */
  apply(args: ConfigMigrationStepApplyArgs): ConfigMigrationStepApplyResult;
}

/** Arguments to a migration step's `apply`. */
export interface ConfigMigrationStepApplyArgs {
  /** The config text fed to the step. */
  text: string;
}

/** The result of applying one migration step. */
export interface ConfigMigrationStepApplyResult {
  /**
   * The text after the step's rewrite. Equal to the input when no change
   * applied — the runner uses an empty `changes` list as the canonical
   * "did nothing" signal.
   */
  rewrittenText: string;
  /** The discrete changes the step made (see {@link MigrationChange}). */
  changes: MigrationChange[];
}

/**
 * One discrete change a migration step made. Steps describe their rewrites
 * as a list of these so consumers (the CLI's human renderer, the `--json`
 * envelope, automation tools) can summarize what happened without
 * re-diffing the text.
 */
export interface MigrationChange {
  /**
   * Where in the config the change happened. Usually a dotted key
   * breadcrumb (`"discovery.plugins[0].use"`, `"publishing.plugin"`,
   * `"$schema"`); a location that is not a key, such as the
   * `"# yaml-language-server"` modeline comment, gets a descriptive
   * label. Stays stable across releases for the same location.
   */
  path: string;
  /** The original string value (or short summary) the user had. */
  before: string;
  /**
   * What the step replaced it with — `kind` + `value` pair captures the most
   * common shape (a discriminated reference) without committing to a
   * specific schema. Future steps can use the same shape (`kind` =
   * `"deprecated-key"` / `value` = the new key, etc.) without changing this
   * type.
   */
  kind: string;
  /** The replacement value paired with {@link MigrationChange.kind}. */
  value: string;
}
