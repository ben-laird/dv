// Resolved, defaults-filled configuration for a `dv` repo
// (specs/config-format.md). Source files are YAML with kebab-case keys; this
// type is the parsed, camelCased shape used internally.
//
// Only sections needed by milestone 1 (discovery) are fully typed. The rest
// keep loose shapes that future subtools will tighten.

// Tagged plugin reference. Exactly one of `path`, `builtin`, or
// `command` is set; the YAML parser (via the discriminated Zod schema
// in subtools/config/schema.ts) guarantees that invariant before any
// runtime code sees this type.
//
//   { path: "./scripts/foo" }       — local file or directory
//   { builtin: "cargo" }            — first-party plugin (none in v1)
//   { command: "my-plugin" }        — binary on $PATH
//
// Replaces the old `use: string` form whose kind was inferred from
// string shape (specs/config-format.md § Plugin resolution).
export type PluginReference =
  | { path: string }
  | { builtin: string }
  | { command: string }
  | { run: string };

export interface PluginAssignment {
  match: string | string[];
  use: PluginReference;
  timeout?: string;
}

// Canonical string key for a PluginReference. Used as a Map key when
// caching `resolvePlugin` results across the assignments in a single
// run, and as the per-Package `plugin` identifier so a Package knows
// which assignment's plugin to invoke without having to carry the
// reference object around.
//
//   { path: "./foo" }                → "path:./foo"
//   { builtin: "cargo" }             → "builtin:cargo"
//   { command: "x" }                 → "command:x"
//   { run: "deno run -A jsr:@s/p" }  → "run:deno run -A jsr:@s/p"
//
// Two assignments referencing the same plugin produce the same key,
// which is what the resolve-once cache relies on. The key is not a
// stable wire format — it's an in-process identifier.
export function pluginReferenceKey(ref: PluginReference): string {
  if ("path" in ref) return `path:${ref.path}`;
  if ("builtin" in ref) return `builtin:${ref.builtin}`;
  if ("command" in ref) return `command:${ref.command}`;
  return `run:${ref.run}`;
}

export interface DiscoveryConfig {
  plugins: PluginAssignment[];
  useGitignore: boolean;
}

export interface RecordsConfig {
  autoStage: boolean;
}

export interface ChangelogConfig {
  format: string;
  location: string;
}

// HISTORY.md is the optional long-form companion document to CHANGELOG.md
// (specs/design.md § Per-package CHANGELOG.md). CHANGELOG stays terse per
// Keep a Changelog conventions; HISTORY carries the full Record body prose
// under h3 subsections so agents and humans get the narrative of why a
// change happened, not just what shipped. Opt-in: defaults to disabled.
export interface HistoryConfig {
  enabled: boolean;
  location: string;
}

export interface TaggingConfig {
  format: string;
}

export interface PublishingConfig {
  plugin?: PluginReference;
  timeout: string;
}

export type GitSign = "auto" | true | false;

export interface GitConfig {
  requireCleanTree: boolean;
  sign: GitSign;
  autoCommit: boolean;
  commitMessageTemplate?: string;
  autoPush: boolean;
  pushSequence: "publish-then-push" | "push-then-publish";
}

export interface SafetyConfig {
  dryRunByDefault: boolean;
}

export interface OverrideEntry {
  match: string | string[];
  changelog?: Partial<ChangelogConfig>;
  history?: Partial<HistoryConfig>;
  tagging?: Partial<TaggingConfig>;
  publishing?: Partial<PublishingConfig>;
  pluginUse?: PluginReference;
}

export interface Config {
  discovery: DiscoveryConfig;
  records: RecordsConfig;
  changelog: ChangelogConfig;
  history: HistoryConfig;
  tagging: TaggingConfig;
  publishing: PublishingConfig;
  git: GitConfig;
  safety: SafetyConfig;
  overrides: OverrideEntry[];
}
