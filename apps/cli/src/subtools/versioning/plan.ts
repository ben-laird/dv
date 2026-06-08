import type { Package } from "../../domain/package.ts";
import type { Record as DvRecord } from "../../domain/record.ts";
import type { Rename } from "../../domain/rename.ts";
import { SCHEMA_URNS } from "../../domain/schema-urns.ts";
import { stabilityOf } from "../../domain/stability.ts";
import { formatVersion, type Version } from "../../domain/version.ts";
import { buildRenameResolver } from "../renames/mod.ts";
import { aggregateBumps } from "./aggregate.ts";
import { applyBump } from "./apply.ts";
import type { Plan, PlanPending } from "./plan-schema.ts";

// buildVersionPlan — the side-effect-free plan builder shared by
// `dv status`, `dv version --dry-run`, and the real `dv version`
// (specs/language.md Algebra §7). Pure: given the same inputs it
// produces the same Plan; executing `dv version` realizes exactly the
// Plan returned here.
//
// Determinism extends to ordering: every list in the Plan is sorted by a
// stable key so the JSON encoding is byte-stable across runs and across
// the three commands. The JSON Schema does not encode ordering — it
// can't — so the contract relies on the builder.

export interface PackageCurrentVersionEntry {
  packageName: string;
  currentVersion: Version;
}

// Pre-computed `awaiting-release` lookup the caller threads into the
// plan builder so the build itself stays pure. Tag presence requires
// shelling out to `git`, which the builder must not do — status and
// release compute this once via the tagging subtool, then pass the
// resulting list in. Omitted → Plan.awaitingRelease stays [].
export interface AwaitingReleaseLookupEntry {
  package: string;
  version: string;
  tag: string;
  firstStable: boolean;
  /**
   * CHANGELOG release notes for this Version. Optional in the lookup —
   * `dv release` fills it; `dv status` / `dv version` leave it absent and
   * the builder defaults it to `""`.
   */
  releaseNotes?: string;
}

export interface BuildVersionPlanArgs {
  command: Plan["command"];
  discoveredPackages: Package[];
  parsedRecords: DvRecord[];
  renameLedger: Rename[];
  packageCurrentVersions: PackageCurrentVersionEntry[];
  awaitingReleaseLookup?: ReadonlyArray<AwaitingReleaseLookupEntry>;
  // Intra-workspace dependency graph: packageName → set of OTHER
  // discovered package names it depends on (from the plugin's optional
  // `get-dependencies` Op, gathered at the IO edge). When provided, a
  // bumped package's `constraintUpdates` lists only packages that
  // actually depend on it. A package ABSENT from the map (its plugin
  // doesn't support the Op) keeps the conservative full cross product,
  // so the dependent isn't silently dropped. Omitting the whole arg
  // reproduces the pre-filter behavior for every package.
  dependencyEdges?: ReadonlyMap<string, ReadonlySet<string>>;
}

export function buildVersionPlan(args: BuildVersionPlanArgs): Plan {
  const renameResolver = buildRenameResolver({ ledger: args.renameLedger });
  const currentVersionsByPackage = indexCurrentVersionsByPackage(
    args.packageCurrentVersions,
  );
  const knownPackageStabilities = buildKnownPackageStabilities({
    discoveredPackages: args.discoveredPackages,
    currentVersionsByPackage,
  });

  const aggregation = aggregateBumps({
    parsedRecords: args.parsedRecords,
    renameResolver,
    knownPackageStabilities,
  });

  const pendingEntries: PlanPending[] = [];
  for (const [
    packageName,
    aggregatedEntry,
  ] of aggregation.aggregatedByPackage) {
    const currentVersion = currentVersionsByPackage.get(packageName);
    const stability = knownPackageStabilities.get(packageName);
    if (currentVersion === undefined || stability === undefined) {
      // Aggregate produced an entry for a Package we don't have a
      // stability for — by construction (aggregate keys on
      // knownPackageStabilities) this is unreachable; guard anyway.
      continue;
    }
    const projectedVersion = applyBump({
      version: currentVersion,
      bump: aggregatedEntry.bump,
    });
    pendingEntries.push({
      package: packageName,
      currentVersion: formatVersion(currentVersion),
      projectedVersion: formatVersion(projectedVersion),
      bump: aggregatedEntry.bump,
      stability,
      changeCounts: aggregatedEntry.changeCounts,
      records: [...aggregatedEntry.recordFilenames],
      // Constraint cascading is *purely additive on existing pending
      // entries* (language.md Algebra §9). This builder never pushes
      // new entries onto pendingEntries on behalf of dependents — it
      // only annotates already-bumped packages with their dependents
      // and the new `projectedVersion` constraint. When dependencyEdges
      // are supplied we list only real dependents; absent that graph we
      // fall back to the full cross product (the plugin still filters at
      // execute time). status and dry-run share this builder, so they
      // agree by construction (Algebra §7).
      constraintUpdates: buildConstraintUpdatesFor({
        bumpedPackageName: packageName,
        bumpedProjectedVersion: formatVersion(projectedVersion),
        discoveredPackages: args.discoveredPackages,
        dependencyEdges: args.dependencyEdges,
      }),
    });
  }
  pendingEntries.sort((leftEntry, rightEntry) =>
    leftEntry.package.localeCompare(rightEntry.package),
  );

  // Every discovered Package whose current Version we resolved becomes
  // a `tracked` entry — independent of pending. Lets `dv status` answer
  // "what's the current version of each Package?" without depending on
  // there being any Records queued.
  const trackedEntries = args.discoveredPackages
    .flatMap((discoveredPackage) => {
      const currentVersion = currentVersionsByPackage.get(
        discoveredPackage.name,
      );
      if (currentVersion === undefined) return [];
      return [
        {
          package: discoveredPackage.name,
          currentVersion: formatVersion(currentVersion),
          path: discoveredPackage.path,
        },
      ];
    })
    .sort((leftEntry, rightEntry) =>
      leftEntry.package.localeCompare(rightEntry.package),
    );

  const awaitingReleaseEntries = (args.awaitingReleaseLookup ?? [])
    .map((entry) => ({
      package: entry.package,
      version: entry.version,
      tag: entry.tag,
      firstStable: entry.firstStable,
      // Populated at the command edge (`dv release`) where CHANGELOG IO
      // lives; the pure plan builder leaves it empty. Never absent.
      releaseNotes: entry.releaseNotes ?? "",
    }))
    .sort((leftEntry, rightEntry) =>
      leftEntry.package.localeCompare(rightEntry.package),
    );

  return {
    schema: SCHEMA_URNS.plan,
    command: args.command,
    pending: pendingEntries,
    awaitingRelease: awaitingReleaseEntries,
    unresolvedReferences: aggregation.unresolvedReferences.map(
      (unresolvedEntry) => ({
        record: unresolvedEntry.recordFilename,
        reference: unresolvedEntry.reference,
      }),
    ),
    tracked: trackedEntries,
  };
}

function indexCurrentVersionsByPackage(
  entries: PackageCurrentVersionEntry[],
): Map<string, Version> {
  const indexed = new Map<string, Version>();
  for (const entry of entries) {
    indexed.set(entry.packageName, entry.currentVersion);
  }
  return indexed;
}

interface BuildKnownPackageStabilitiesArgs {
  discoveredPackages: Package[];
  currentVersionsByPackage: Map<string, Version>;
}

function buildKnownPackageStabilities(
  args: BuildKnownPackageStabilitiesArgs,
): Map<string, ReturnType<typeof stabilityOf>> {
  const stabilities = new Map<string, ReturnType<typeof stabilityOf>>();
  for (const discoveredPackage of args.discoveredPackages) {
    const currentVersion = args.currentVersionsByPackage.get(
      discoveredPackage.name,
    );
    if (currentVersion === undefined) continue;
    stabilities.set(discoveredPackage.name, stabilityOf(currentVersion));
  }
  return stabilities;
}

interface BuildConstraintUpdatesForArgs {
  bumpedPackageName: string;
  bumpedProjectedVersion: string;
  discoveredPackages: Package[];
  dependencyEdges?: ReadonlyMap<string, ReadonlySet<string>>;
}

interface ConstraintUpdate {
  dependent: string;
  newConstraint: string;
}

// For each bumped Package, list the *other* discovered Packages whose
// constraint on it would be rewritten. When the candidate's dependency
// edges are known (its plugin answered `get-dependencies`), include it
// only if it actually depends on the bumped Package. When they're
// unknown (no entry in the map — plugin lacks the Op), keep it as a
// candidate and let the plugin filter at execute time via
// `changed: false`. Pre-sorted by `dependent` for byte-stable JSON.
function buildConstraintUpdatesFor(
  args: BuildConstraintUpdatesForArgs,
): ConstraintUpdate[] {
  const updates: ConstraintUpdate[] = [];
  for (const candidateDependent of args.discoveredPackages) {
    if (candidateDependent.name === args.bumpedPackageName) continue;
    const knownDependencies = args.dependencyEdges?.get(
      candidateDependent.name,
    );
    if (
      knownDependencies !== undefined &&
      !knownDependencies.has(args.bumpedPackageName)
    ) {
      // Edges known and this package does NOT depend on the bumped one.
      continue;
    }
    updates.push({
      dependent: candidateDependent.name,
      newConstraint: args.bumpedProjectedVersion,
    });
  }
  updates.sort((leftUpdate, rightUpdate) =>
    leftUpdate.dependent.localeCompare(rightUpdate.dependent),
  );
  return updates;
}
