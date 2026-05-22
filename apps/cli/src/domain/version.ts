import {
  compare as compareSemVer,
  format as formatSemVer,
  parse as parseSemVer,
  type SemVer,
} from "@std/semver";
import { DvError } from "./errors.ts";

// A Version is the SemVer triple `(major, minor, patch)` from
// specs/language.md § Domains. We reuse @std/semver's structural type
// so comparison and parsing come for free; `dv` only needs the major/
// minor/patch trio for the algebra, but the rest of the SemVer shape
// (prerelease, build) rides along without harm.

export type Version = SemVer;

export function parseVersion(rawText: string): Version {
  try {
    return parseSemVer(rawText);
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    throw new DvError({
      code: "version-parse",
      message: `invalid semver '${rawText}': ${reason}`,
      context: { rawText },
      cause: caughtError,
    });
  }
}

export function formatVersion(version: Version): string {
  return formatSemVer(version);
}

export function compareVersions(left: Version, right: Version): number {
  return compareSemVer(left, right);
}
