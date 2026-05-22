import type { Package } from "../../domain/package.ts";
import { formatVersion, type Version } from "../../domain/version.ts";
import { listTagsMatching, tagExists } from "../git/mod.ts";
import { formatTag } from "./format.ts";

// Computes which Packages are awaiting release — i.e. their current
// Version has no matching git Tag (specs/language.md Algebra §4:
// release state lives entirely in Tags). Both `dv status` and `dv
// release` need this lookup; it lives here so the IO sits in the
// tagging subtool rather than leaking into the cli layer.
//
// For each entry, also asks the first-stable question: if the
// incoming version is exactly `1.0.0` AND the Package has no prior
// tags at all, mark `firstStable: true`. Algebra §3 says no Record
// can produce 1.0.0, so an incoming 1.0.0 with no prior history is
// always the moment a Package crosses out of Unstable.
//
// Performance: N+1 git invocations per call (one `rev-parse` per
// Package, plus one `tag --list` per 1.0.0-candidate). Acceptable
// for v1; a batched query is a polish item.

export interface PackageWithCurrentVersion {
  pkg: Package;
  currentVersion: Version;
}

export interface ComputeAwaitingReleaseArgs {
  repoRootPath: string;
  packagesWithVersions: PackageWithCurrentVersion[];
  tagFormatTemplate: string;
}

export interface AwaitingReleaseEntry {
  package: string;
  version: string;
  tag: string;
  firstStable: boolean;
}

export async function computeAwaitingRelease(
  args: ComputeAwaitingReleaseArgs,
): Promise<AwaitingReleaseEntry[]> {
  const awaiting: AwaitingReleaseEntry[] = [];
  for (const { pkg, currentVersion } of args.packagesWithVersions) {
    const versionString = formatVersion(currentVersion);
    const tagString = formatTag({
      package: pkg,
      version: versionString,
      template: args.tagFormatTemplate,
    });
    const alreadyTagged = await tagExists({
      repoRootPath: args.repoRootPath,
      tag: tagString,
    });
    if (alreadyTagged) continue;

    const isFirstStable = await detectFirstStable({
      repoRootPath: args.repoRootPath,
      pkg,
      versionString,
    });
    awaiting.push({
      package: pkg.name,
      version: versionString,
      tag: tagString,
      firstStable: isFirstStable,
    });
  }
  awaiting.sort((leftEntry, rightEntry) =>
    leftEntry.package.localeCompare(rightEntry.package),
  );
  return awaiting;
}

interface DetectFirstStableArgs {
  repoRootPath: string;
  pkg: Package;
  versionString: string;
}

async function detectFirstStable(
  args: DetectFirstStableArgs,
): Promise<boolean> {
  if (args.versionString !== "1.0.0") return false;
  const priorTags = await listTagsMatching({
    repoRootPath: args.repoRootPath,
    pattern: `${args.pkg.name}@*`,
  });
  return priorTags.length === 0;
}
