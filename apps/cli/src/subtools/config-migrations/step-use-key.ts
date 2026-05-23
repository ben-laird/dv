import type {
  ConfigMigrationStepApplyArgs,
  ConfigMigrationStepApplyResult,
  MigrationChange,
} from "./step-types.ts";

// Migration step: rewrite the pre-1.0 string form of `use:` /
// `publishing.plugin` / `overrides[].plugin-use` to the new
// tagged reference shape (specs/config-format.md § Plugin
// resolution). The pre-1.0 overload was:
//
//   use: ./scripts/foo    # path-shaped → local plugin
//   use: cargo            # bare name → builtin lookup
//
// The post-redesign shape is a tagged object with exactly one of
// `path:`, `builtin:`, or `command:`. This step preserves the
// legacy resolver's exact shape heuristic so a migrated config
// resolves identically: path-shaped strings become `path:`,
// everything else becomes `builtin:`.

const STEP_ID = "use-key-discriminated";
const STEP_DESCRIPTION =
  "Rewrite the pre-1.0 string form of `use:` / `publishing.plugin` / `overrides[].plugin-use` into the tagged reference shape (path / builtin / command).";

export function apply(
  args: ConfigMigrationStepApplyArgs,
): ConfigMigrationStepApplyResult {
  const lines = args.text.split("\n");
  const outputLines: string[] = [];
  const changes: MigrationChange[] = [];

  // Lightweight section tracking: we need to know *which* parent
  // block each `use:` / `plugin:` / `plugin-use:` line lives
  // under so the breadcrumb in the change record names the right
  // location. The tracking is structural (most recent top-level
  // key seen at column 0, plus whether we're inside
  // `discovery.plugins:` or `overrides:`) rather than semantic —
  // enough for the three legacy locations.
  let currentTopLevel: string | undefined;
  let insideDiscoveryPlugins = false;
  let insideOverrides = false;
  let pluginAssignmentIndex = -1;
  let overrideEntryIndex = -1;

  for (const line of lines) {
    const topLevelMatch = /^([A-Za-z_$][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (topLevelMatch) {
      currentTopLevel = topLevelMatch[1];
      insideDiscoveryPlugins = false;
      insideOverrides = false;
      pluginAssignmentIndex = -1;
      overrideEntryIndex = -1;
    }
    if (currentTopLevel === "discovery") {
      const pluginsKeyMatch = /^\s+plugins:\s*$/.exec(line);
      if (pluginsKeyMatch) insideDiscoveryPlugins = true;
    }
    if (currentTopLevel === "overrides") {
      insideOverrides = true;
    }
    // A new list-entry marker bumps the per-entry index so the
    // breadcrumb path is accurate.
    const listEntryMatch = /^(\s+)-\s/.exec(line);
    if (listEntryMatch) {
      if (insideDiscoveryPlugins) pluginAssignmentIndex += 1;
      if (insideOverrides) overrideEntryIndex += 1;
    }

    // discovery.plugins[].use: <string>
    if (insideDiscoveryPlugins) {
      const useMatch = /^(\s+)use:\s+([^\s{].*?)\s*$/.exec(line);
      if (useMatch) {
        const indentation = useMatch[1] ?? "";
        const legacyValue = (useMatch[2] ?? "").trim();
        const kind = inferLegacyKind(legacyValue);
        outputLines.push(`${indentation}use:`);
        outputLines.push(`${indentation}  ${kind}: ${legacyValue}`);
        changes.push({
          path: `discovery.plugins[${pluginAssignmentIndex}].use`,
          before: legacyValue,
          kind,
          value: legacyValue,
        });
        continue;
      }
    }

    // publishing.plugin: <string>
    if (currentTopLevel === "publishing") {
      const pluginMatch = /^(\s+)plugin:\s+([^\s{].*?)\s*$/.exec(line);
      if (pluginMatch) {
        const indentation = pluginMatch[1] ?? "";
        const legacyValue = (pluginMatch[2] ?? "").trim();
        const kind = inferLegacyKind(legacyValue);
        outputLines.push(`${indentation}plugin:`);
        outputLines.push(`${indentation}  ${kind}: ${legacyValue}`);
        changes.push({
          path: "publishing.plugin",
          before: legacyValue,
          kind,
          value: legacyValue,
        });
        continue;
      }
    }

    // overrides[].plugin-use: <string>
    if (insideOverrides) {
      const pluginUseMatch = /^(\s+)plugin-use:\s+([^\s{].*?)\s*$/.exec(line);
      if (pluginUseMatch) {
        const indentation = pluginUseMatch[1] ?? "";
        const legacyValue = (pluginUseMatch[2] ?? "").trim();
        const kind = inferLegacyKind(legacyValue);
        outputLines.push(`${indentation}plugin-use:`);
        outputLines.push(`${indentation}  ${kind}: ${legacyValue}`);
        changes.push({
          path: `overrides[${overrideEntryIndex}].plugin-use`,
          before: legacyValue,
          kind,
          value: legacyValue,
        });
        continue;
      }
    }

    outputLines.push(line);
  }

  return {
    rewrittenText: outputLines.join("\n"),
    changes,
  };
}

// The legacy resolver's exact shape heuristic — preserved here so
// a migrated config behaves identically to the legacy parser
// would have. A value beginning with ./, ../, /, or ~ is a path;
// anything else was a builtin lookup (which errored in v1 and
// still does, by the same path, in the new resolver).
function inferLegacyKind(legacyValue: string): "path" | "builtin" {
  if (
    legacyValue.startsWith("./") ||
    legacyValue.startsWith("../") ||
    legacyValue.startsWith("/") ||
    legacyValue.startsWith("~/") ||
    legacyValue === "~"
  ) {
    return "path";
  }
  return "builtin";
}

// Step descriptor exported as the public surface of this file.
// The registry in steps.ts imports `useKeyStep`; nothing else
// outside this file imports `apply` directly.
export const useKeyStep = {
  id: STEP_ID,
  description: STEP_DESCRIPTION,
  apply,
};
