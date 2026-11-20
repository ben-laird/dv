// The config's schema pointers: the `# yaml-language-server: $schema=`
// modeline and the top-level `$schema` key. Both are read from the raw
// text (the modeline is a comment, so the parsed YAML never sees it).
// Shared by `dv migrate config` (which rewrites them) and `dv validate`
// (which warns about them).

import { greaterThan, lessThan, tryParse } from "@std/semver";

/** Which of the two schema pointers a finding is about. */
export type SchemaPointerKind = "modeline" | "key";

/** Matches a modeline: prefix, URL, trailing whitespace. */
export const SCHEMA_MODELINE_PATTERN: RegExp =
  /^(\s*#\s*yaml-language-server:\s*\$schema=)(\S+)(\s*)$/;

/** Matches a top-level `$schema` key: prefix, quote, URL, trailing text. */
export const SCHEMA_KEY_PATTERN: RegExp =
  /^(\$schema:[ \t]*)(["']?)([^"'\s#]+)\2(.*)$/;

const DV_CONFIG_SCHEMA_URL_PATTERN =
  /^https:\/\/jsr\.io\/@dv-cli\/dv\/([^/\s]+)\/schemas\/config\.json$/;

/** The schema pointers found in a config's text; a pointer is absent when undefined. */
export interface SchemaPointers {
  /** URL from the `# yaml-language-server: $schema=` modeline. */
  modeline?: string;
  /** URL from the top-level `$schema` key. */
  key?: string;
}

/** Reads the first modeline and the first top-level `$schema` key from config text. */
export function readSchemaPointers(configText: string): SchemaPointers {
  const pointers: SchemaPointers = {};
  for (const line of configText.split("\n")) {
    const modelineUrl = SCHEMA_MODELINE_PATTERN.exec(line)?.[2];
    if (modelineUrl !== undefined && pointers.modeline === undefined) {
      pointers.modeline = modelineUrl;
    }
    const keyUrl = SCHEMA_KEY_PATTERN.exec(line)?.[3];
    if (keyUrl !== undefined && pointers.key === undefined) {
      pointers.key = keyUrl;
    }
  }
  return pointers;
}

/**
 * The dv version a URL names, when it is dv's published config schema
 * (`https://jsr.io/@dv-cli/dv/<version>/schemas/config.json`); otherwise
 * `undefined`.
 */
export function dvConfigSchemaVersion(url: string): string | undefined {
  return DV_CONFIG_SCHEMA_URL_PATTERN.exec(url)?.[1];
}

/** How a pointed-at dv version relates to the running one. */
export type SchemaVersionDirection = "older" | "newer" | "unordered";

/**
 * Something worth telling the user about the config's schema pointers.
 * `incomplete`: exactly one of the two pointers is present.
 * `version-mismatch`: a pointer names dv's config schema for a version
 * other than the running one (`unordered` when either is not SemVer).
 */
export type SchemaPointerFinding =
  | { kind: "incomplete"; present: SchemaPointerKind; url: string }
  | {
      kind: "version-mismatch";
      pointer: SchemaPointerKind;
      pointedVersion: string;
      direction: SchemaVersionDirection;
    };
// {}

/** Arguments to {@link diagnoseSchemaPointers}. */
export interface DiagnoseSchemaPointersArgs {
  /** The pointers read from the config (see {@link readSchemaPointers}). */
  pointers: SchemaPointers;
  /** The running dv release. */
  runningVersion: string;
}

/**
 * Pure check of a config's schema pointers against the running dv. A
 * config with neither pointer has opted out and yields no findings;
 * pointers at anything other than dv's published config schema are never
 * version-checked.
 */
export function diagnoseSchemaPointers(
  args: DiagnoseSchemaPointersArgs,
): SchemaPointerFinding[] {
  const findings: SchemaPointerFinding[] = [];
  const { modeline, key } = args.pointers;
  if (modeline !== undefined && key === undefined) {
    findings.push({ kind: "incomplete", present: "modeline", url: modeline });
  }
  if (key !== undefined && modeline === undefined) {
    findings.push({ kind: "incomplete", present: "key", url: key });
  }
  const presentPointers: [SchemaPointerKind, string | undefined][] = [
    ["modeline", modeline],
    ["key", key],
  ];
  for (const [pointer, url] of presentPointers) {
    const pointedVersion =
      url === undefined ? undefined : dvConfigSchemaVersion(url);
    if (
      pointedVersion === undefined ||
      pointedVersion === args.runningVersion
    ) {
      continue;
    }
    findings.push({
      kind: "version-mismatch",
      pointer,
      pointedVersion,
      direction: compareDirection({
        pointedVersion,
        runningVersion: args.runningVersion,
      }),
    });
  }
  return findings;
}

interface CompareDirectionArgs {
  pointedVersion: string;
  runningVersion: string;
}

function compareDirection(args: CompareDirectionArgs): SchemaVersionDirection {
  const pointed = tryParse(args.pointedVersion);
  const running = tryParse(args.runningVersion);
  if (pointed === undefined || running === undefined) {
    return "unordered";
  }
  if (lessThan(pointed, running)) {
    return "older";
  }
  if (greaterThan(pointed, running)) {
    return "newer";
  }
  return "unordered";
}
