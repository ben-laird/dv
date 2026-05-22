import type { Bump } from "../../domain/bump.ts";
import type { ChangeType } from "../../domain/change-type.ts";
import type { Record as DvRecord } from "../../domain/record.ts";
import type { Stability } from "../../domain/stability.ts";
import type { RenameResolver } from "../renames/mod.ts";
import { joinBumps } from "./bump-join.ts";
import { classify } from "./classify.ts";

// aggregateBumps fuses many Records into the per-Package Bump map per
// specs/language.md Algebra §1 (bump aggregation as a join). Pure; order-
// independent (commutativity of joinBumps); does no IO.
//
// Records reference packages by name; the rename ledger maps old names
// to the current Package name. A reference that does not resolve to a
// known Package is an **Unresolved Reference** — collected separately,
// not silently dropped. `dv version` halts on these unless --prune.

export interface ChangeCounts {
  feat: number;
  fix: number;
  breaking: number;
}

export interface AggregatedPackageBump {
  bump: Bump;
  recordFilenames: string[];
  changeCounts: ChangeCounts;
}

export interface UnresolvedReference {
  recordFilename: string;
  reference: string;
}

export interface AggregateResult {
  aggregatedByPackage: Map<string, AggregatedPackageBump>;
  unresolvedReferences: UnresolvedReference[];
}

export interface AggregateBumpsArgs {
  parsedRecords: DvRecord[];
  renameResolver: RenameResolver;
  knownPackageStabilities: Map<string, Stability>;
}

export function aggregateBumps(args: AggregateBumpsArgs): AggregateResult {
  const { parsedRecords, renameResolver, knownPackageStabilities } = args;

  const aggregatedByPackage = new Map<string, AggregatedPackageBump>();
  const unresolvedReferences: UnresolvedReference[] = [];

  for (const parsedRecord of parsedRecords) {
    for (const packageReference of parsedRecord.packages) {
      const resolvedName =
        renameResolver.resolve(packageReference) ?? packageReference;
      const stability = knownPackageStabilities.get(resolvedName);
      if (stability === undefined) {
        unresolvedReferences.push({
          recordFilename: parsedRecord.filename,
          reference: packageReference,
        });
        continue;
      }
      contributeRecordToAggregate({
        aggregatedByPackage,
        resolvedPackageName: resolvedName,
        recordFilename: parsedRecord.filename,
        changeType: parsedRecord.type,
        stability,
      });
    }
  }

  unresolvedReferences.sort((leftRef, rightRef) => {
    const filenameCompare = leftRef.recordFilename.localeCompare(
      rightRef.recordFilename,
    );
    if (filenameCompare !== 0) return filenameCompare;
    return leftRef.reference.localeCompare(rightRef.reference);
  });

  for (const entry of aggregatedByPackage.values()) {
    entry.recordFilenames.sort((leftName, rightName) =>
      leftName.localeCompare(rightName),
    );
  }

  return { aggregatedByPackage, unresolvedReferences };
}

interface ContributeRecordToAggregateArgs {
  aggregatedByPackage: Map<string, AggregatedPackageBump>;
  resolvedPackageName: string;
  recordFilename: string;
  changeType: ChangeType;
  stability: Stability;
}

function contributeRecordToAggregate(
  args: ContributeRecordToAggregateArgs,
): void {
  const recordBump = classify({
    changeType: args.changeType,
    stability: args.stability,
  });
  const existing = args.aggregatedByPackage.get(args.resolvedPackageName);
  if (existing === undefined) {
    args.aggregatedByPackage.set(args.resolvedPackageName, {
      bump: recordBump,
      recordFilenames: dedupedAppend([], args.recordFilename),
      changeCounts: changeCountsFor(args.changeType),
    });
    return;
  }
  existing.bump = joinBumps(existing.bump, recordBump);
  existing.recordFilenames = dedupedAppend(
    existing.recordFilenames,
    args.recordFilename,
  );
  existing.changeCounts = addChangeCounts(
    existing.changeCounts,
    changeCountsFor(args.changeType),
  );
}

function dedupedAppend(existing: string[], candidate: string): string[] {
  return existing.includes(candidate) ? existing : [...existing, candidate];
}

function changeCountsFor(changeType: ChangeType): ChangeCounts {
  const isBreaking = changeType === "feat!" || changeType === "fix!";
  return {
    feat: changeType === "feat" || changeType === "feat!" ? 1 : 0,
    fix: changeType === "fix" || changeType === "fix!" ? 1 : 0,
    breaking: isBreaking ? 1 : 0,
  };
}

function addChangeCounts(
  left: ChangeCounts,
  right: ChangeCounts,
): ChangeCounts {
  return {
    feat: left.feat + right.feat,
    fix: left.fix + right.fix,
    breaking: left.breaking + right.breaking,
  };
}
