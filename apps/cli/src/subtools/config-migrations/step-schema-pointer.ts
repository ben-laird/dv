import { lessThan, tryParse } from "@std/semver";
import { publishedSchemaUrl } from "../../domain/published-schema.ts";
import {
  dvConfigSchemaVersion,
  SCHEMA_KEY_PATTERN,
  SCHEMA_MODELINE_PATTERN,
} from "../config/schema-pointer.ts";
import type {
  ConfigMigrationStep,
  ConfigMigrationStepApplyArgs,
  ConfigMigrationStepApplyResult,
  MigrationChange,
} from "./step-types.ts";

// Migration step: move the config's schema pointers (the
// `# yaml-language-server: $schema=` modeline and the top-level
// `$schema` key) forward to the running dv's published config schema
// when they name an older dv release. Any other URL (a local path, a
// fork, a newer dv) is the user's choice and stays untouched.

const STEP_ID = "schema-pointer-current";
const STEP_DESCRIPTION =
  "Point the `# yaml-language-server` modeline and the `$schema` key at the running dv's published config schema when they name an older dv release.";

/** The {@link MigrationChange.path} reported for a rewritten modeline. */
export const MODELINE_CHANGE_PATH = "# yaml-language-server";
/** The {@link MigrationChange.path} reported for a rewritten `$schema` key. */
export const SCHEMA_KEY_CHANGE_PATH = "$schema";
/** The {@link MigrationChange.kind} this step reports. */
export const SCHEMA_URL_CHANGE_KIND = "schema-url";

/** Arguments to {@link createSchemaPointerStep}. */
export interface CreateSchemaPointerStepArgs {
  /** The running dv release, e.g. `0.12.0`. */
  runningVersion: string;
}

/**
 * Builds the `schema-pointer-current` migration step for one running dv
 * release. Its `apply` stays pure: the version is fixed at construction.
 */
export function createSchemaPointerStep(
  args: CreateSchemaPointerStepArgs,
): ConfigMigrationStep {
  return {
    id: STEP_ID,
    description: STEP_DESCRIPTION,
    apply: (applyArgs) => {
      return rewriteSchemaPointers({
        text: applyArgs.text,
        runningVersion: args.runningVersion,
      });
    },
  };
}

interface RewriteSchemaPointersArgs extends ConfigMigrationStepApplyArgs {
  runningVersion: string;
}

function rewriteSchemaPointers(
  args: RewriteSchemaPointersArgs,
): ConfigMigrationStepApplyResult {
  const runningSemVer = tryParse(args.runningVersion);
  if (runningSemVer === undefined) {
    return { rewrittenText: args.text, changes: [] };
  }
  const currentUrl = publishedSchemaUrl({
    version: args.runningVersion,
    schema: "config",
  });
  const isOlderDvSchemaUrl = (url: string): boolean => {
    const versionText = dvConfigSchemaVersion(url);
    const pointedSemVer =
      versionText === undefined ? undefined : tryParse(versionText);
    return (
      pointedSemVer !== undefined && lessThan(pointedSemVer, runningSemVer)
    );
  };

  const changes: MigrationChange[] = [];
  const recordChange = (change: { path: string; before: string }): void => {
    changes.push({
      path: change.path,
      before: change.before,
      kind: SCHEMA_URL_CHANGE_KIND,
      value: currentUrl,
    });
  };

  const outputLines = args.text.split("\n").map((line) => {
    const modelineMatch = SCHEMA_MODELINE_PATTERN.exec(line);
    if (modelineMatch) {
      const [, prefix = "", url = "", trailing = ""] = modelineMatch;
      if (!isOlderDvSchemaUrl(url)) return line;
      recordChange({ path: MODELINE_CHANGE_PATH, before: url });
      return `${prefix}${currentUrl}${trailing}`;
    }
    const schemaKeyMatch = SCHEMA_KEY_PATTERN.exec(line);
    if (schemaKeyMatch) {
      const [, prefix = "", quote = "", url = "", trailing = ""] =
        schemaKeyMatch;
      if (!isOlderDvSchemaUrl(url)) return line;
      recordChange({ path: SCHEMA_KEY_CHANGE_PATH, before: url });
      return `${prefix}${quote}${currentUrl}${quote}${trailing}`;
    }
    return line;
  });

  return { rewrittenText: outputLines.join("\n"), changes };
}
