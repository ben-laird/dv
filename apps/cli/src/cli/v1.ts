import { join, relative } from "@std/path";
import { DvError } from "../domain/errors.ts";
import type { Package } from "../domain/package.ts";
import type { Record as DvRecord } from "../domain/record.ts";
import { SCHEMA_URNS } from "../domain/schema-urns.ts";
import { parseVersion } from "../domain/version.ts";
import {
  renderReleaseSection,
  resolveOutputPathFromTemplate,
  upsertChangelogSection,
} from "../subtools/changelog/mod.ts";
import { configPath, loadConfig, recordsPath } from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import type { ResolvedPlugin } from "../subtools/discovery/resolve.ts";
import {
  loadInfoForAllPlugins,
  resolveAllPlugins,
} from "../subtools/discovery/resolve-all.ts";
import {
  assertCleanTree,
  assertNoUnstagedFinalizeDrift,
  commitChanges,
  requireRepoRoot,
  stageFiles,
} from "../subtools/git/mod.ts";
import {
  renderHistorySection,
  upsertHistorySection,
} from "../subtools/history/mod.ts";
import type { TracingHooks } from "../subtools/plugin/mod.ts";
import { listRecords } from "../subtools/records/mod.ts";
import { loadRenameLedger, renamesPath } from "../subtools/renames/mod.ts";
import { buildRenameResolver } from "../subtools/renames/resolve.ts";
import { computeAwaitingRelease } from "../subtools/tagging/mod.ts";
import {
  computeDependencyEdges,
  invokeFinalize,
  invokeReadVersion,
  invokeUpdateDependency,
  invokeWriteVersion,
  type PackageCurrentVersionEntry,
  type Plan,
  type PlanPending,
  renderCommitMessage,
} from "../subtools/versioning/mod.ts";
import { makeStderrTracingHooks } from "./debug-trace.ts";
import {
  makeLiveProgressReporter,
  makeSilentProgressReporter,
  type ProgressReporter,
} from "./progress.ts";
import { makeStyler } from "./styler.ts";

// `dv v1 <package>` per specs/cli.md § dv v1. The 1.0 commitment.
// Promotes one pre-1.0 Package to exactly 1.0.0: a stability promise
// that no Record type can produce (Algebra §3 caps Unstable bumps
// below major). Therefore `dv v1` exists as the one deliberate,
// gated path across that boundary.
//
// What this command does:
//   1. discover packages, load config, locate the target package
//   2. error if it doesn't exist or is already >= 1.0
//   3. assemble pending records for the target (resolving renames),
//      halting on unresolved references unless --prune
//   4. confirm with the user (TTY) or require --yes (non-TTY)
//   5. invoke write-version → 1.0.0
//   6. render & prepend the 1.0.0 CHANGELOG (and HISTORY, if enabled)
//   7. delete the consumed records (and pruned ones, if --prune)
//   8. run the constraint cascade (other packages with constraints
//      on this one get rewritten)
//   9. stage everything, commit
//
// The 🎉 first-stable celebration line in `dv release`'s summary
// fires on the next `dv release` run, because `computeAwaitingRelease`
// notices the new 1.0.0 with no prior tags.

const DEFAULT_FAST_OP_TIMEOUT_MS = 60_000;

/** Inputs to {@link runV1}, the gated `dv v1 <package>` 0.x → 1.0.0 promotion. */
export interface RunV1Options {
  /** Name of the Unstable Package to promote to 1.0.0. */
  packageName: string;
  /** Preview only, with zero side effects; flag overrides `safety.dry-run-by-default`. */
  dryRun?: boolean;
  /** Stage and finalize files but skip the git commit. */
  noCommit: boolean;
  /** Drop Unresolved References instead of halting on them. */
  prune: boolean;
  /** Emit the machine-readable `--json` result instead of human output. */
  emitJson: boolean;
  /** Whether ANSI color is enabled for human output. */
  colorEnabled: boolean;
  /** Skip the confirmation prompt (required in non-TTY contexts). */
  yes: boolean;
  /** Proceed despite a dirty working tree. */
  allowDirty?: boolean;
  /** Emit plugin stderr tracing for debugging. */
  debug?: boolean;
}

/** Outcome of a {@link runV1} promotion. */
export interface RunV1Result {
  /** The {@link Plan} that was computed and executed. */
  plan: Plan;
  /** SHA of the promotion commit, or `null` when `noCommit`/dry-run. */
  commitSha: string | null;
  /** Name of the Package promoted to 1.0.0. */
  promotedPackage: string;
  /** Number of Records consumed by the promotion. */
  consumedRecordCount: number;
  /** Constraint-only cascades applied to consumers of the promoted Package. */
  cascadedUpdates: CascadedUpdate[];
  /** Manifest files a write-version plugin staged into the commit. */
  finalizedFiles: FinalizedFile[];
}

/** A single constraint-only cascade: a consumer's manifest updated to the new Version. */
export interface CascadedUpdate {
  /** The Package whose Version bumped, triggering the cascade. */
  bumpedPackage: string;
  /** The consuming Package whose manifest constraint was updated. */
  dependent: string;
  /** Path to the consumer's manifest file that was rewritten. */
  dependentPath: string;
}

/**
 * One additional file the finalize pass staged into the v1 commit.
 * `dv v1` only ever bumps one Package, so there's at most one plugin
 * involved; we still carry the same shape as `version`'s
 * `RunVersionResult` for consistency (callers reading the result don't
 * have to branch on the command).
 */
export interface FinalizedFile {
  /** Key of the plugin that produced the file. */
  pluginKey: string;
  /** Path to the staged file. */
  path: string;
}

/**
 * Execute the gated `dv v1 <package>` promotion: bumps the named Unstable
 * Package to its 1.0.0 Stability commitment, cascades constraints to
 * consumers, and (unless dry-run or `noCommit`) commits the result.
 */
export async function runV1(options: RunV1Options): Promise<RunV1Result> {
  const repoRootPath = await requireRepoRoot();
  const configFilePath = configPath(repoRootPath);
  const loadedConfig = await loadConfig(configFilePath);
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;

  const effectiveDryRun = options.dryRun ?? loadedConfig.safety.dryRunByDefault;
  const effectiveRequireCleanTree =
    options.allowDirty === true
      ? false
      : options.allowDirty === false
        ? true
        : loadedConfig.git.requireCleanTree;
  if (!effectiveDryRun && effectiveRequireCleanTree) {
    await assertCleanTree({ repoRootPath });
  }

  // Discover and resolve the target package. Per Algebra §3, the
  // promotion is only valid when the current version is Unstable
  // (major == 0); anything else means the Package is already at or
  // past 1.0 and this command would be a no-op (or worse, a
  // backwards step).
  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath,
    tracingHooks,
  });
  const targetPackage = discoveredPackages.find(
    (pkg) => pkg.name === options.packageName,
  );
  if (targetPackage === undefined) {
    throw new DvError({
      code: "v1-package-not-found",
      message: `package '${options.packageName}' not found in discovered packages`,
      hint: "run `dv status` to see the list of discovered packages; check the `discovery.plugins` glob in your config",
      context: {
        requestedPackage: options.packageName,
        knownPackages: discoveredPackages.map((pkg) => pkg.name),
      },
    });
  }

  const resolvedPluginsByUseString = await resolveAllPlugins({
    pluginAssignments: loadedConfig.discovery.plugins,
    repoRootPath,
  });
  const pluginInfoCache = await loadInfoForAllPlugins({
    resolvedPluginsByKey: resolvedPluginsByUseString,
    timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
    tracingHooks,
  });
  const targetPlugin = resolvedPluginsByUseString.get(targetPackage.plugin);
  if (targetPlugin === undefined) {
    throw new DvError({
      code: "internal-plan-mismatch",
      message: `no resolved plugin for '${targetPackage.plugin}'`,
    });
  }
  const currentVersion = await invokeReadVersion({
    repoRootPath,
    pkg: targetPackage,
    resolvedPlugin: targetPlugin,
    timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
    tracingHooks,
  });
  if (currentVersion.major !== 0) {
    const currentVersionText = `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}`;
    throw new DvError({
      code: "v1-already-stable",
      message: `package '${targetPackage.name}' is at ${currentVersionText}, which is already >= 1.0`,
      hint: "`dv v1` only promotes 0.x.y Packages to 1.0.0; subsequent stable bumps go through `dv version`",
      context: {
        package: targetPackage.name,
        currentVersion: currentVersionText,
      },
    });
  }

  // Gather the Records that target this Package, applying the rename
  // ledger so old names route to the current identity (same rules as
  // `dv version`).
  const recordsListing = await listRecords({
    recordsDirectory: recordsPath(repoRootPath),
  });
  if (recordsListing.failures.length > 0) {
    throw new DvError({
      code: "malformed-records",
      message: `${recordsListing.failures.length} record file${
        recordsListing.failures.length === 1 ? "" : "s"
      } failed to parse — run \`dv validate\` to see details`,
      hint: "run `dv validate` for per-record diagnostics",
      context: { failureCount: recordsListing.failures.length },
    });
  }
  const renameLedger = await loadRenameLedger({
    ledgerPath: renamesPath(repoRootPath),
  });
  const renameResolver = buildRenameResolver({ ledger: renameLedger });
  const discoveredNames = new Set(discoveredPackages.map((pkg) => pkg.name));

  // Records relevant to the promotion: any record that references
  // this package (post-rename-resolution) is consumed. Records that
  // reference unknown packages would normally halt `dv version`;
  // honor the same --prune semantics here. We aggregate unresolved
  // refs across *all* records (not just this package's) for parity
  // with the version pipeline.
  const consumedRecords: DvRecord[] = [];
  const unresolvedReferences: { record: string; reference: string }[] = [];
  const recordsByFilename = new Map<string, DvRecord>();
  for (const parsedRecord of recordsListing.parsedRecords) {
    recordsByFilename.set(parsedRecord.filename, parsedRecord);
    let targetsThisPackage = false;
    for (const referenced of parsedRecord.packages) {
      const resolved = renameResolver.resolve(referenced) ?? referenced;
      if (!discoveredNames.has(resolved)) {
        unresolvedReferences.push({
          record: parsedRecord.filename,
          reference: referenced,
        });
        continue;
      }
      if (resolved === targetPackage.name) targetsThisPackage = true;
    }
    if (targetsThisPackage) consumedRecords.push(parsedRecord);
  }

  if (unresolvedReferences.length > 0 && !options.prune) {
    throw new DvError({
      code: "unresolved-reference",
      message: `${unresolvedReferences.length} record${
        unresolvedReferences.length === 1 ? "" : "s"
      } reference a Package not found — pass --prune to drop them, or use \`dv rename\` to record the lineage`,
      hint: "use `dv rename <from> <to>` to declare lineage, or pass --prune to drop the references",
      context: { count: unresolvedReferences.length },
    });
  }

  // Build the awaitingRelease lookup so the Plan we emit matches
  // what dv status / dv version would emit (Algebra §7 parity).
  const packagesByName = new Map(
    discoveredPackages.map((pkg) => [pkg.name, pkg] as const),
  );
  const allPackageCurrentVersions = await readAllCurrentVersions({
    discoveredPackages,
    resolvedPluginsByUseString,
    repoRootPath,
    tracingHooks,
  });
  const awaitingReleaseLookup = await computeAwaitingRelease({
    repoRootPath,
    tagFormatTemplate: loadedConfig.tagging.format,
    packagesWithVersions: allPackageCurrentVersions.flatMap((entry) => {
      const pkg = packagesByName.get(entry.packageName);
      return pkg === undefined
        ? []
        : [{ pkg, currentVersion: entry.currentVersion }];
    }),
  });

  // Hand-construct the Plan: one pending entry for the target,
  // projected version pinned to 1.0.0, change-counts derived from
  // the consumed records' types. Cascade entries cover every other
  // discovered package (the plugin filters at execute time).
  const changeCounts = computeChangeCounts(consumedRecords);
  const currentVersionText = `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}`;
  // Resolve the real dependency graph so the cascade names only packages
  // that actually depend on the promoted target — not the full cross
  // product. A package whose plugin lacks `get-dependencies` has unknown
  // edges and stays a candidate (the plugin filters at execute time).
  const dependencyEdges = await computeDependencyEdges({
    discoveredPackages,
    resolvedPluginsByUseString,
    pluginInfoCache,
    repoRootPath,
    timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
    tracingHooks,
  });
  const constraintUpdates = discoveredPackages
    .filter((pkg) => pkg.name !== targetPackage.name)
    .filter((pkg) => {
      const knownDependencies = dependencyEdges.get(pkg.name);
      return (
        knownDependencies === undefined ||
        knownDependencies.has(targetPackage.name)
      );
    })
    .map((pkg) => ({
      dependent: pkg.name,
      newConstraint: "^1.0.0",
    }))
    .sort((leftUpdate, rightUpdate) =>
      leftUpdate.dependent.localeCompare(rightUpdate.dependent),
    );
  const pendingEntry: PlanPending = {
    package: targetPackage.name,
    currentVersion: currentVersionText,
    projectedVersion: "1.0.0",
    bump: "major",
    stability: "Stable",
    changeCounts,
    records: consumedRecords.map((rec) => rec.filename).sort(),
    constraintUpdates,
  };
  const plan: Plan = {
    schema: SCHEMA_URNS.plan,
    command: "version",
    pending: [pendingEntry],
    awaitingRelease: awaitingReleaseLookup.map((entry) => ({
      ...entry,
      releaseNotes: "",
    })),
    unresolvedReferences,
    tracked: allPackageCurrentVersions.map((entry) => {
      const pkg = packagesByName.get(entry.packageName);
      const versionText = `${entry.currentVersion.major}.${entry.currentVersion.minor}.${entry.currentVersion.patch}`;
      return {
        package: entry.packageName,
        currentVersion: versionText,
        path: pkg?.path ?? "",
      };
    }),
  };

  if (effectiveDryRun) {
    if (options.emitJson) console.log(JSON.stringify(plan, null, 2));
    else renderHumanPlan({ plan, colorEnabled: options.colorEnabled });
    return {
      plan,
      commitSha: null,
      promotedPackage: targetPackage.name,
      consumedRecordCount:
        consumedRecords.length +
        (options.prune ? unresolvedReferences.length : 0),
      cascadedUpdates: [],
      finalizedFiles: [],
    };
  }

  assertConfirmedOrYes({
    yes: options.yes,
    targetPackage: targetPackage.name,
    currentVersion: currentVersionText,
  });

  // Execute the plan. The shape mirrors runVersion's per-package
  // loop but for the single target.
  const v1OpLabels = [
    "write-version",
    "changelog",
    "cascade",
    "finalize",
    "commit",
  ];
  const progressReporter: ProgressReporter = options.emitJson
    ? makeSilentProgressReporter()
    : makeLiveProgressReporter({
        colorEnabled: options.colorEnabled,
        packageColumnWidth: targetPackage.name.length,
        operationColumnWidth: Math.max(
          ...v1OpLabels.map((label) => label.length),
          0,
        ),
      });

  const dateString = todayDateString();
  const touchedPaths: string[] = [];

  const writeStep = progressReporter.start({
    packageName: targetPackage.name,
    operationName: "write-version",
  });
  try {
    await invokeWriteVersion({
      repoRootPath,
      pkg: targetPackage,
      resolvedPlugin: targetPlugin,
      newVersion: parseVersion("1.0.0"),
      timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
      tracingHooks,
    });
    writeStep.done();
  } catch (caughtError) {
    writeStep.fail(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    throw caughtError;
  }
  touchedPaths.push(targetPackage.path);

  const changelogStep = progressReporter.start({
    packageName: targetPackage.name,
    operationName: "changelog",
  });
  try {
    const newSection = renderReleaseSection({
      newVersion: "1.0.0",
      bump: "major",
      records: consumedRecords,
      dateString,
    });
    const changelogPath = resolveOutputPathFromTemplate({
      package: targetPackage,
      locationTemplate: loadedConfig.changelog.location,
      newVersion: "1.0.0",
      repoRootPath,
    });
    await upsertChangelogSection({ changelogPath, newSection });
    touchedPaths.push(relative(repoRootPath, changelogPath));

    if (loadedConfig.history.enabled) {
      const historySection = renderHistorySection({
        newVersion: "1.0.0",
        records: consumedRecords,
        dateString,
      });
      const historyPath = resolveOutputPathFromTemplate({
        package: targetPackage,
        locationTemplate: loadedConfig.history.location,
        newVersion: "1.0.0",
        repoRootPath,
      });
      await upsertHistorySection({
        historyPath,
        newSection: historySection,
      });
      touchedPaths.push(relative(repoRootPath, historyPath));
    }
    changelogStep.done();
  } catch (caughtError) {
    changelogStep.fail(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    throw caughtError;
  }

  // Delete the consumed records (and pruned unresolved ones, if --prune).
  const consumedRecordFilenames = new Set<string>(
    consumedRecords.map((rec) => rec.filename),
  );
  if (options.prune) {
    for (const unresolved of unresolvedReferences) {
      consumedRecordFilenames.add(unresolved.record);
    }
  }
  for (const recordFilename of consumedRecordFilenames) {
    const recordPath = join(recordsPath(repoRootPath), recordFilename);
    await Deno.remove(recordPath);
    touchedPaths.push(relative(repoRootPath, recordPath));
  }

  // Constraint cascade — every other discovered package gets a
  // chance to rewrite its constraint on the bumped package. The
  // plugin filters at execute time via changed:false for dependents
  // that don't carry the dep.
  const cascadeStep = progressReporter.start({
    packageName: "",
    operationName: "cascade",
  });
  let cascadedUpdates: CascadedUpdate[];
  try {
    cascadedUpdates = await runCascadePass({
      bumpedPackage: targetPackage,
      bumpedVersion: "1.0.0",
      otherPackages: discoveredPackages.filter(
        (pkg) => pkg.name !== targetPackage.name,
      ),
      resolvedPluginsByUseString,
      repoRootPath,
      tracingHooks,
    });
    cascadeStep.done();
  } catch (caughtError) {
    cascadeStep.fail(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    throw caughtError;
  }
  for (const update of cascadedUpdates) {
    touchedPaths.push(update.dependentPath);
  }

  // Finalize the target package's plugin so generated companion
  // files (deno.lock, etc.) refresh and ship with this commit.
  // v1 only ever bumps one package, so there's exactly one plugin
  // to finalize — no grouping needed. See specs/plugin-contract.md
  // § finalize and dv version's finalize loop for context.
  //
  // Skipped when the plugin didn't declare finalize in
  // info.supportedOps. The info cache was populated up front so
  // this is a pure lookup.
  const finalizedFiles: FinalizedFile[] = [];
  const targetSupportsFinalize =
    pluginInfoCache
      .get(targetPackage.plugin)
      ?.supportedOps.includes("finalize") === true;
  if (targetSupportsFinalize) {
    const finalizeStep = progressReporter.start({
      packageName: "",
      operationName: "finalize",
    });
    try {
      const finalizeResult = await invokeFinalize({
        repoRootPath,
        resolvedPlugin: targetPlugin,
        bumpedPackages: [
          {
            name: targetPackage.name,
            path: targetPackage.path,
            newVersion: "1.0.0",
          },
        ],
        trigger: "v1",
        timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
        tracingHooks,
      });
      for (const additionalFile of finalizeResult.additionalChangedFiles) {
        touchedPaths.push(additionalFile);
        finalizedFiles.push({
          pluginKey: targetPackage.plugin,
          path: additionalFile,
        });
      }
      finalizeStep.done();
    } catch (caughtError) {
      finalizeStep.fail(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
      throw caughtError;
    }
  }

  await stageFiles({ repoRootPath, paths: touchedPaths });

  const shouldCommit = loadedConfig.git.autoCommit && !options.noCommit;

  // Backstop: a finalize plugin may have refreshed a companion file
  // (deno.lock, package-lock.json, …) without reporting it, so it
  // never got staged. Only matters when we're about to commit — in
  // staged-only mode leaving drift for the user to inspect is fine.
  if (shouldCommit) {
    const styler = makeStyler(options.colorEnabled);
    await assertNoUnstagedFinalizeDrift({
      repoRootPath,
      requireCleanTree: effectiveRequireCleanTree,
      warn: (unstagedPaths) => {
        console.error(
          `${styler.yellow(styler.bold("warning"))}: ${unstagedPaths.length} ` +
            `file(s) changed by finalize were not staged (a plugin did not ` +
            `report them): ${unstagedPaths.join(", ")}`,
        );
      },
    });
  }

  let commitSha: string | null = null;
  if (shouldCommit) {
    const commitStep = progressReporter.start({
      packageName: "",
      operationName: "commit",
    });
    try {
      const message = renderCommitMessage({
        plan,
        template: loadedConfig.git.commitMessageTemplate,
        prunedUnresolved: options.prune && unresolvedReferences.length > 0,
      });
      const commitResult = await commitChanges({
        repoRootPath,
        message,
        sign: loadedConfig.git.sign,
      });
      commitSha = commitResult.commitSha;
      commitStep.done();
    } catch (caughtError) {
      commitStep.fail(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
      throw caughtError;
    }
  }

  renderHumanSummary({
    promotedPackage: targetPackage.name,
    currentVersion: currentVersionText,
    commitSha,
    staged: !shouldCommit,
    cascadedUpdates,
    finalizedFiles,
    colorEnabled: options.colorEnabled,
  });

  return {
    plan,
    commitSha,
    promotedPackage: targetPackage.name,
    consumedRecordCount: consumedRecordFilenames.size,
    cascadedUpdates,
    finalizedFiles,
  };
}

interface AssertConfirmedOrYesArgs {
  yes: boolean;
  targetPackage: string;
  currentVersion: string;
}

function assertConfirmedOrYes(args: AssertConfirmedOrYesArgs): void {
  if (args.yes) return;
  const isInteractive = Deno.stdin.isTerminal();
  if (!isInteractive) {
    throw new DvError({
      code: "confirmation-required",
      message: "dv v1 in a non-TTY context requires --yes to confirm",
      hint: "rerun with --yes to skip the prompt (e.g. in CI)",
    });
  }
  // Same Deno.prompt() pattern as `dv release` for now; the real
  // prompt subtool follow-up (tracked in ROADMAP.md) replaces both.
  const answer = prompt(
    `About to commit ${args.targetPackage} to 1.0.0 — this is a stability promise.\nProceed? [y/N]`,
  );
  if (answer !== "y" && answer !== "Y") {
    throw new DvError({
      code: "v1-cancelled",
      message: "user declined the v1 promotion prompt",
    });
  }
}

interface RunCascadePassArgs {
  bumpedPackage: Package;
  bumpedVersion: string;
  otherPackages: Package[];
  resolvedPluginsByUseString: Map<string, ResolvedPlugin>;
  repoRootPath: string;
  tracingHooks?: TracingHooks;
}

async function runCascadePass(
  args: RunCascadePassArgs,
): Promise<CascadedUpdate[]> {
  const cascadedUpdates: CascadedUpdate[] = [];
  for (const dependent of args.otherPackages) {
    const resolvedPlugin = args.resolvedPluginsByUseString.get(
      dependent.plugin,
    );
    if (resolvedPlugin === undefined) continue;
    const response = await invokeUpdateDependency({
      repoRootPath: args.repoRootPath,
      pkg: dependent,
      resolvedPlugin,
      dependencyName: args.bumpedPackage.name,
      newVersion: parseVersion(args.bumpedVersion),
      timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
      tracingHooks: args.tracingHooks,
    });
    if (response.changed) {
      cascadedUpdates.push({
        bumpedPackage: args.bumpedPackage.name,
        dependent: dependent.name,
        dependentPath: dependent.path,
      });
    }
  }
  return cascadedUpdates;
}

interface ReadAllCurrentVersionsArgs {
  discoveredPackages: Package[];
  resolvedPluginsByUseString: Map<string, ResolvedPlugin>;
  repoRootPath: string;
  tracingHooks?: TracingHooks;
}

async function readAllCurrentVersions(
  args: ReadAllCurrentVersionsArgs,
): Promise<PackageCurrentVersionEntry[]> {
  const entries: PackageCurrentVersionEntry[] = [];
  for (const discoveredPackage of args.discoveredPackages) {
    const resolvedPlugin = args.resolvedPluginsByUseString.get(
      discoveredPackage.plugin,
    );
    if (resolvedPlugin === undefined) continue;
    const currentVersion = await invokeReadVersion({
      repoRootPath: args.repoRootPath,
      pkg: discoveredPackage,
      resolvedPlugin,
      timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
      tracingHooks: args.tracingHooks,
    });
    entries.push({
      packageName: discoveredPackage.name,
      currentVersion,
    });
  }
  return entries;
}

function computeChangeCounts(records: DvRecord[]): {
  feat: number;
  fix: number;
  breaking: number;
} {
  let feat = 0;
  let fix = 0;
  let breaking = 0;
  for (const record of records) {
    if (record.type === "feat!" || record.type === "fix!") breaking += 1;
    if (record.type === "feat" || record.type === "feat!") feat += 1;
    if (record.type === "fix" || record.type === "fix!") fix += 1;
  }
  return { feat, fix, breaking };
}

function todayDateString(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface RenderHumanPlanArgs {
  plan: Plan;
  colorEnabled: boolean;
}

function renderHumanPlan(args: RenderHumanPlanArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  console.log(`${styler.bold("Plan (dry-run)")}:`);
  for (const pending of args.plan.pending) {
    console.log(
      `  ${styler.bold(pending.package)} ${pending.currentVersion} → ${styler.yellow(styler.bold(pending.projectedVersion))} (${styler.yellow("first stable!")})`,
    );
    if (pending.constraintUpdates.length > 0) {
      const dependentNames = pending.constraintUpdates
        .map((update) => update.dependent)
        .join(", ");
      console.log(
        `       ${styler.dim(`└ would update dependents: ${dependentNames}`)}`,
      );
    }
  }
  if (args.plan.unresolvedReferences.length > 0) {
    console.log("");
    console.log(
      `${styler.yellow(styler.bold("Unresolved references"))} (halt without ${styler.cyan(
        "--prune",
      )}):`,
    );
    for (const unresolved of args.plan.unresolvedReferences) {
      console.log(
        `  ${styler.dim(unresolved.record)} → ${unresolved.reference}`,
      );
    }
  }
  console.log("");
}

interface RenderHumanSummaryArgs {
  promotedPackage: string;
  currentVersion: string;
  commitSha: string | null;
  staged: boolean;
  cascadedUpdates: CascadedUpdate[];
  finalizedFiles: FinalizedFile[];
  colorEnabled: boolean;
}

// === catalog mode (dv v1 --dry-run with no package) =============
//
// Lists every discovered Package currently in the Unstable regime
// (major == 0) along with the per-package Plan that
// `dv v1 <pkg> --dry-run` would emit. A discovery aid for "which
// of these is ready to promote?" — *not* a bulk-promote, which is
// why catalog mode is dry-run-only.

/** Inputs to {@link runV1Catalog}, the dry-run-only `dv v1` discovery listing. */
export interface RunV1CatalogOptions {
  /**
   * Honors the same dry-run resolution as {@link runV1} (flag > config >
   * false). Catalog mode requires effective dry-run to be true — it has
   * no real-run path because there's no single target to promote. The
   * leaf passes through whatever the user supplied; we resolve and
   * enforce here so the policy lives in one place.
   */
  dryRun?: boolean;
  /** Drop Unresolved References instead of halting on them. */
  prune: boolean;
  /** Emit the machine-readable `--json` result instead of human output. */
  emitJson: boolean;
  /** Whether ANSI color is enabled for human output. */
  colorEnabled: boolean;
  /** Emit plugin stderr tracing for debugging. */
  debug?: boolean;
}

/** Result of {@link runV1Catalog}: the projected promotion Plan for every Unstable Package. */
export interface RunV1CatalogResult {
  /**
   * A standard {@link Plan} with N pending entries — one per Unstable
   * Package — each projected to 1.0.0. Tracked still lists every
   * discovered Package so callers comparing against `dv status`'s
   * output see the same shape. Unresolved References are computed
   * against the *whole* Record set, same as {@link runV1}, so the
   * catalog surfaces ledger issues that would block any actual promotion.
   */
  plan: Plan;
  /**
   * Convenience count of Unstable Packages eligible for promotion;
   * redundant with `plan` but matches the shape {@link RunV1Result} returns.
   */
  eligibleCount: number;
}

/**
 * List every discovered Package currently in the Unstable regime (major
 * == 0) alongside the per-Package {@link Plan} that `dv v1 <pkg> --dry-run`
 * would emit. A discovery aid for "which of these is ready to promote?" —
 * *not* a bulk-promote, which is why catalog mode is dry-run-only.
 */
export async function runV1Catalog(
  options: RunV1CatalogOptions,
): Promise<RunV1CatalogResult> {
  const repoRootPath = await requireRepoRoot();
  const configFilePath = configPath(repoRootPath);
  const loadedConfig = await loadConfig(configFilePath);
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;

  const effectiveDryRun = options.dryRun ?? loadedConfig.safety.dryRunByDefault;
  if (!effectiveDryRun) {
    // Catalog mode is preview-only. The leaf reaches here when
    // <package> was omitted; without dry-run that's just a usage
    // error — bulk-promote isn't a feature.
    throw new DvError({
      code: "v1-bad-args",
      message:
        "dv v1 requires <package> for a real run; catalog mode (omitted package) requires --dry-run",
      hint: "pass `dv v1 --dry-run` for the catalog, or `dv v1 <package>` to promote one Package",
    });
  }

  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath,
    tracingHooks,
  });
  const resolvedPluginsByUseString = await resolveAllPlugins({
    pluginAssignments: loadedConfig.discovery.plugins,
    repoRootPath,
  });
  // Load info eagerly so contract-version mismatches surface here
  // (same reason as runV1 / runVersion). The result isn't otherwise
  // used in catalog mode, but the up-front check matters.
  await loadInfoForAllPlugins({
    resolvedPluginsByKey: resolvedPluginsByUseString,
    timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
    tracingHooks,
  });

  const allPackageCurrentVersions = await readAllCurrentVersions({
    discoveredPackages,
    resolvedPluginsByUseString,
    repoRootPath,
    tracingHooks,
  });
  const versionByPackageName = new Map(
    allPackageCurrentVersions.map(
      (entry) => [entry.packageName, entry.currentVersion] as const,
    ),
  );

  // Load + parse Records once; resolve rename targets so per-package
  // Record bucketing routes old names to current identities (same
  // rules as runV1).
  const recordsListing = await listRecords({
    recordsDirectory: recordsPath(repoRootPath),
  });
  if (recordsListing.failures.length > 0) {
    throw new DvError({
      code: "malformed-records",
      message: `${recordsListing.failures.length} record file${
        recordsListing.failures.length === 1 ? "" : "s"
      } failed to parse — run \`dv validate\` to see details`,
      hint: "run `dv validate` for per-record diagnostics",
      context: { failureCount: recordsListing.failures.length },
    });
  }
  const renameLedger = await loadRenameLedger({
    ledgerPath: renamesPath(repoRootPath),
  });
  const renameResolver = buildRenameResolver({ ledger: renameLedger });
  const discoveredNames = new Set(discoveredPackages.map((pkg) => pkg.name));

  // Bucket Records by the package they target (post-rename). One
  // Record can target multiple packages → it shows up in multiple
  // buckets. Unresolved References get collected once.
  const recordsByTargetName = new Map<string, DvRecord[]>();
  const unresolvedReferences: { record: string; reference: string }[] = [];
  for (const parsedRecord of recordsListing.parsedRecords) {
    for (const referenced of parsedRecord.packages) {
      const resolved = renameResolver.resolve(referenced) ?? referenced;
      if (!discoveredNames.has(resolved)) {
        unresolvedReferences.push({
          record: parsedRecord.filename,
          reference: referenced,
        });
        continue;
      }
      const existingForName = recordsByTargetName.get(resolved) ?? [];
      existingForName.push(parsedRecord);
      recordsByTargetName.set(resolved, existingForName);
    }
  }

  // Honor --prune semantics for parity with runV1: without it, an
  // Unresolved Reference is information the catalog should surface
  // but not a hard halt (catalog is preview-only — the actual
  // promotion will halt later if the user hasn't resolved the issue).
  // We dedupe so the same (record, reference) doesn't appear twice
  // if the Record listed it multiple times.
  const dedupedUnresolved = dedupeUnresolvedReferences(unresolvedReferences);

  // Build one PlanPending per Unstable Package.
  const pendingEntries: PlanPending[] = [];
  for (const pkg of discoveredPackages) {
    const currentVersion = versionByPackageName.get(pkg.name);
    if (currentVersion === undefined) continue;
    if (currentVersion.major !== 0) continue;
    const recordsForThisPackage = recordsByTargetName.get(pkg.name) ?? [];
    const constraintUpdates = discoveredPackages
      .filter((otherPkg) => otherPkg.name !== pkg.name)
      .map((otherPkg) => ({
        dependent: otherPkg.name,
        newConstraint: "^1.0.0",
      }))
      .sort((leftUpdate, rightUpdate) =>
        leftUpdate.dependent.localeCompare(rightUpdate.dependent),
      );
    const currentVersionText = `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}`;
    pendingEntries.push({
      package: pkg.name,
      currentVersion: currentVersionText,
      projectedVersion: "1.0.0",
      bump: "major",
      stability: "Stable",
      changeCounts: computeChangeCounts(recordsForThisPackage),
      records: recordsForThisPackage.map((rec) => rec.filename).sort(),
      constraintUpdates,
    });
  }
  // Sort by package name so output is byte-stable across runs.
  pendingEntries.sort((leftEntry, rightEntry) =>
    leftEntry.package.localeCompare(rightEntry.package),
  );

  const packagesByName = new Map(
    discoveredPackages.map((pkg) => [pkg.name, pkg] as const),
  );
  const awaitingReleaseLookup = await computeAwaitingRelease({
    repoRootPath,
    tagFormatTemplate: loadedConfig.tagging.format,
    packagesWithVersions: allPackageCurrentVersions.flatMap((entry) => {
      const pkg = packagesByName.get(entry.packageName);
      return pkg === undefined
        ? []
        : [{ pkg, currentVersion: entry.currentVersion }];
    }),
  });

  const plan: Plan = {
    schema: SCHEMA_URNS.plan,
    command: "version",
    pending: pendingEntries,
    awaitingRelease: awaitingReleaseLookup.map((entry) => ({
      ...entry,
      releaseNotes: "",
    })),
    unresolvedReferences: dedupedUnresolved,
    tracked: allPackageCurrentVersions.map((entry) => {
      const pkg = packagesByName.get(entry.packageName);
      const versionText = `${entry.currentVersion.major}.${entry.currentVersion.minor}.${entry.currentVersion.patch}`;
      return {
        package: entry.packageName,
        currentVersion: versionText,
        path: pkg?.path ?? "",
      };
    }),
  };

  if (options.emitJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    renderCatalogHumanPlan({
      plan,
      colorEnabled: options.colorEnabled,
      prune: options.prune,
    });
  }

  return {
    plan,
    eligibleCount: pendingEntries.length,
  };
}

function dedupeUnresolvedReferences(
  unresolvedReferences: { record: string; reference: string }[],
): { record: string; reference: string }[] {
  const seen = new Set<string>();
  const out: { record: string; reference: string }[] = [];
  for (const entry of unresolvedReferences) {
    const key = `${entry.record}\x00${entry.reference}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

interface RenderCatalogHumanPlanArgs {
  plan: Plan;
  colorEnabled: boolean;
  prune: boolean;
}

function renderCatalogHumanPlan(args: RenderCatalogHumanPlanArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  if (args.plan.pending.length === 0) {
    console.log(
      `${styler.dim("no packages eligible for")} ${styler.cyan("`dv v1`")} ${styler.dim("— every Package is already ≥ 1.0 or undiscovered")}`,
    );
    console.log("");
    return;
  }
  const headerSuffix = args.plan.pending.length === 1 ? "" : `s`;
  console.log(
    `${styler.bold(`Catalog (dry-run): ${args.plan.pending.length} eligible Package${headerSuffix}`)}:`,
  );
  for (const pending of args.plan.pending) {
    const recordSuffix =
      pending.records.length === 0
        ? styler.dim(" (no pending records)")
        : styler.dim(
            ` (${pending.records.length} record${pending.records.length === 1 ? "" : "s"})`,
          );
    console.log(
      `  ${styler.bold(pending.package)} ${pending.currentVersion} → ${styler.yellow(styler.bold(pending.projectedVersion))} (${styler.yellow("first stable!")})${recordSuffix}`,
    );
    if (pending.constraintUpdates.length > 0) {
      const dependentNames = pending.constraintUpdates
        .map((update) => update.dependent)
        .join(", ");
      console.log(
        `       ${styler.dim(`└ would update dependents: ${dependentNames}`)}`,
      );
    }
  }
  if (args.plan.unresolvedReferences.length > 0) {
    console.log("");
    console.log(
      `${styler.yellow(styler.bold("Unresolved references"))} (would halt ${styler.cyan("dv v1")} without ${styler.cyan("--prune")}):`,
    );
    for (const unresolved of args.plan.unresolvedReferences) {
      console.log(
        `  ${styler.dim(unresolved.record)} → ${unresolved.reference}`,
      );
    }
  }
  console.log("");
  console.log(
    `${styler.dim("Promote one with")} ${styler.cyan("`dv v1 <package>`")}${args.prune ? styler.dim(" --prune") : ""}${styler.dim(".")}`,
  );
  console.log("");
}

function renderHumanSummary(args: RenderHumanSummaryArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  const commitSuffix = args.commitSha
    ? `, committed ${styler.dim(args.commitSha.slice(0, 7))}`
    : args.staged
      ? `, ${styler.dim("staged for review")}`
      : "";
  console.log(
    `${styler.green(styler.bold("✓"))} promoted ${styler.bold(args.promotedPackage)} ${args.currentVersion} → ${styler.yellow(styler.bold("1.0.0"))}${commitSuffix}`,
  );
  console.log(
    `  ${styler.yellow(`🎉 stability promise made — run \`dv release\` to mint ${args.promotedPackage}@1.0.0 and celebrate.`)}`,
  );
  if (args.cascadedUpdates.length > 0) {
    console.log("");
    const dependentNames = [
      ...new Set(args.cascadedUpdates.map((update) => update.dependent)),
    ].join(", ");
    console.log(
      `  ${styler.dim(
        `↳ updated ${args.cascadedUpdates.length} dependent constraint${
          args.cascadedUpdates.length === 1 ? "" : "s"
        } (${dependentNames})`,
      )}`,
    );
  }
  if (args.finalizedFiles.length > 0) {
    console.log("");
    const uniquePaths = [
      ...new Set(args.finalizedFiles.map((entry) => entry.path)),
    ].sort();
    const fileCount = uniquePaths.length;
    const fileWord = fileCount === 1 ? "file" : "files";
    console.log(
      `  ${styler.dim(
        `↳ refreshed ${fileCount} ${fileWord} (${uniquePaths.join(", ")})`,
      )}`,
    );
  }
  console.log("");
}
