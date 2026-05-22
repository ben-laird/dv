// Resolved, defaults-filled configuration for a `dv` repo
// (specs/config-format.md). Source files are YAML with kebab-case keys; this
// type is the parsed, camelCased shape used internally.
//
// Only sections needed by milestone 1 (discovery) are fully typed. The rest
// keep loose shapes that future subtools will tighten.

export interface PluginAssignment {
  match: string | string[];
  use: string;
  timeout?: string;
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

export interface TaggingConfig {
  format: string;
}

export interface PublishingConfig {
  plugin?: string;
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
  tagging?: Partial<TaggingConfig>;
  publishing?: Partial<PublishingConfig>;
  pluginUse?: string;
}

export interface Config {
  discovery: DiscoveryConfig;
  records: RecordsConfig;
  changelog: ChangelogConfig;
  tagging: TaggingConfig;
  publishing: PublishingConfig;
  git: GitConfig;
  safety: SafetyConfig;
  overrides: OverrideEntry[];
}
