import type { Config } from "../../domain/config.ts";

// Defaults from specs/config-format.md and specs/schemas/config.json.
// Empty `discovery.plugins` means "no packages tracked" (still valid).

export function defaults(): Config {
  return {
    discovery: { plugins: [], useGitignore: true },
    changesets: { autoStage: true },
    changelog: {
      format: "keep-a-changelog",
      location: "{package-path}/CHANGELOG.md",
    },
    tagging: { format: "{package}@{version}" },
    publishing: { timeout: "none" },
    git: {
      requireCleanTree: true,
      sign: "auto",
      autoCommit: true,
      autoPush: false,
      pushSequence: "publish-then-push",
    },
    safety: { dryRunByDefault: false },
    overrides: [],
  };
}
