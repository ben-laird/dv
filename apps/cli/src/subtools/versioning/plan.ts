import type { Package } from "../../domain/package.ts";
import type { Record as DvRecord } from "../../domain/record.ts";
import type { Rename } from "../../domain/rename.ts";
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
}

export interface BuildVersionPlanArgs {
  command: Plan["command"];
  discoveredPackages: Package[];
  parsedRecords: DvRecord[];
  renameLedger: Rename[];
  packageCurrentVersions: PackageCurrentVersionEntry[];
  awaitingReleaseLookup?: ReadonlyArray<AwaitingReleaseLookupEntry>;
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
      // only annotates already-bumped packages with the cross product
      // of `dependent → projectedVersion`. The plugin filters at
      // execute time; the plan reports the full cross product so
      // status and dry-run agree (Algebra §7).
      constraintUpdates: buildConstraintUpdatesFor({
        bumpedPackageName: packageName,
        bumpedProjectedVersion: formatVersion(projectedVersion),
        discoveredPackages: args.discoveredPackages,
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
    }))
    .sort((leftEntry, rightEntry) =>
      leftEntry.package.localeCompare(rightEntry.package),
    );

  return {
    schema: "urn:dv:schema:v1:plan",
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
}

interface ConstraintUpdate {
  dependent: string;
  newConstraint: string;
}

// Quadratic cross product: for each bumped Package, list every *other*
// discovered Package as a dependent whose constraint *would* be
// rewritten if it carried this dependency. The plugin filters at
// execute time via `changed: false`. Pre-sorted by `dependent` for
// byte-stable JSON.
function buildConstraintUpdatesFor(
  args: BuildConstraintUpdatesForArgs,
): ConstraintUpdate[] {
  const updates: ConstraintUpdate[] = [];
  for (const candidateDependent of args.discoveredPackages) {
    if (candidateDependent.name === args.bumpedPackageName) continue;
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
