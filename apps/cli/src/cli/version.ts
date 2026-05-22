import { join, relative } from "@std/path";
import type { PluginAssignment } from "../domain/config.ts";
import { DvError } from "../domain/errors.ts";
import type { Package } from "../domain/package.ts";
import type { Record as DvRecord } from "../domain/record.ts";
import { parseVersion } from "../domain/version.ts";
import {
  renderReleaseSection,
  upsertChangelogSection,
} from "../subtools/changelog/mod.ts";
import { configPath, loadConfig, recordsPath } from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import {
  type ResolvedPlugin,
  resolvePlugin,
} from "../subtools/discovery/resolve.ts";
import {
  assertCleanTree,
  commitChanges,
  requireRepoRoot,
  stageFiles,
} from "../subtools/git/mod.ts";
import {
  renderHistorySection,
  upsertHistorySection,
} from "../subtools/history/mod.ts";
import { listRecords } from "../subtools/records/mod.ts";
import { loadRenameLedger, renamesPath } from "../subtools/renames/mod.ts";
import { computeAwaitingRelease } from "../subtools/tagging/mod.ts";
import {
  buildVersionPlan,
  invokeReadVersion,
  invokeUpdateDependency,
  invokeWriteVersion,
  type PackageCurrentVersionEntry,
  type Plan,
  type PlanPending,
  renderCommitMessage,
} from "../subtools/versioning/mod.ts";

// `dv version` per specs/cli.md § dv version. Consumes pending Records
// and (per Package) applies the aggregated Bump, rewrites the manifest
// Version, prepends a CHANGELOG section, deletes the consumed Records,
// and stages everything into one commit (the Release PR).
//
// Plan-then-execute is the spine (specs/language.md Algebra §7): the
// same buildVersionPlan call powers `dv status`, `dv version --dry-run`,
// and the real run. The dry-run path invokes zero write-side plugin Ops
// and touches nothing on disk.

const DEFAULT_FAST_OP_TIMEOUT_MS = 60_000;

export interface RunVersionOptions {
  dryRun?: boolean;
  noCommit: boolean;
  prune: boolean;
  emitJson: boolean;
  colorEnabled: boolean;
  // `--yes` is accepted as a no-op in M3 (dv version doesn't prompt);
  // wired here so the flag is forward-compatible with later milestones.
  yes: boolean;
}

export interface RunVersionResult {
  plan: Plan;
  commitSha: string | null;
  bumpedPackageCount: number;
  consumedRecordCount: number;
  cascadedUpdates: CascadedUpdate[];
}

// A single actual constraint rewrite the cascade pass executed (the
// plugin reported changed:true). The dependentPath is relative to
// repoRootPath and gets pushed into touchedPaths so the rewrite lands
// in the version commit.
interface CascadedUpdate {
  bumpedPackage: string;
  dependent: string;
  dependentPath: string;
}

export async function runVersion(
  options: RunVersionOptions,
): Promise<RunVersionResult> {
  const repoRootPath = await requireRepoRoot();
  const configFilePath = configPath(repoRootPath);
  const loadedConfig = await loadConfig(configFilePath);

  const effectiveDryRun = options.dryRun ?? loadedConfig.safety.dryRunByDefault;

  if (!effectiveDryRun && loadedConfig.git.requireCleanTree) {
    await assertCleanTree({ repoRootPath });
  }

  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath,
  });
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

  const resolvedPluginsByUseString = await resolveAllPlugins({
    pluginAssignments: loadedConfig.discovery.plugins,
    repoRootPath,
  });
  const packageCurrentVersions = await readAllCurrentVersions({
    discoveredPackages,
    resolvedPluginsByUseString,
    repoRootPath,
  });

  // Compute the awaiting-release set so the Plan dv version emits
  // matches dv status's Plan byte-for-byte (Algebra §7: status / dry-
  // run / real run share one builder, one Plan shape). dv version
  // itself doesn't *use* awaitingRelease — that's dv release's
  // concern — but populating it keeps the parity contract honest.
  const packagesByName = new Map(
    discoveredPackages.map((pkg) => [pkg.name, pkg] as const),
  );
  const awaitingReleaseLookup = await computeAwaitingRelease({
    repoRootPath,
    tagFormatTemplate: loadedConfig.tagging.format,
    packagesWithVersions: packageCurrentVersions.flatMap((entry) => {
      const pkg = packagesByName.get(entry.packageName);
      return pkg === undefined
        ? []
        : [{ pkg, currentVersion: entry.currentVersion }];
    }),
  });

  const plan = buildVersionPlan({
    command: "version",
    discoveredPackages,
    parsedRecords: recordsListing.parsedRecords,
    renameLedger,
    packageCurrentVersions,
    awaitingReleaseLookup,
  });

  if (plan.unresolvedReferences.length > 0 && !options.prune) {
    throw new DvError({
      code: "unresolved-reference",
      message: `${plan.unresolvedReferences.length} record${
        plan.unresolvedReferences.length === 1 ? "" : "s"
      } reference a Package not found — pass --prune to drop them, or use \`dv rename\` to record the lineage`,
      hint: "use `dv rename <from> <to>` to declare lineage, or pass --prune to drop the references",
      context: { count: plan.unresolvedReferences.length },
    });
  }

  // Idempotence (Algebra §5): no records pending and no orphans to
  // prune → no-op exit 0.
  const nothingToDo =
    plan.pending.length === 0 &&
    (plan.unresolvedReferences.length === 0 || !options.prune);
  if (nothingToDo) {
    if (options.emitJson) console.log(renderPlanJson(plan));
    else console.log("dv: nothing to version");
    return {
      plan,
      commitSha: null,
      bumpedPackageCount: 0,
      consumedRecordCount: 0,
      cascadedUpdates: [],
    };
  }

  if (effectiveDryRun) {
    if (options.emitJson) console.log(renderPlanJson(plan));
    else renderHumanPlan({ plan, colorEnabled: options.colorEnabled });
    return {
      plan,
      commitSha: null,
      bumpedPackageCount: plan.pending.length,
      consumedRecordCount: countConsumedRecords({
        plan,
        prune: options.prune,
      }),
      cascadedUpdates: [],
    };
  }

  // Execute the plan. Indexes for the file IO.
  const discoveredPackageByName = indexPackagesByName(discoveredPackages);
  const recordsByFilename = indexRecordsByFilename(
    recordsListing.parsedRecords,
  );
  const dateString = todayDateString();
  const touchedPaths: string[] = [];

  for (const pendingEntry of plan.pending) {
    const pkg = discoveredPackageByName.get(pendingEntry.package);
    if (pkg === undefined) {
      throw new DvError({
        code: "internal-plan-mismatch",
        message: `plan named package '${pendingEntry.package}' that discovery did not list`,
      });
    }
    const resolvedPlugin = resolvedPluginsByUseString.get(pkg.plugin);
    if (resolvedPlugin === undefined) {
      throw new DvError({
        code: "internal-plan-mismatch",
        message: `no resolved plugin for '${pkg.plugin}'`,
      });
    }
    await invokeWriteVersion({
      repoRootPath,
      pkg,
      resolvedPlugin,
      newVersion: parseVersion(pendingEntry.projectedVersion),
      timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
    });
    touchedPaths.push(pkg.path);

    const recordsForPackage = pendingEntry.records.map((recordFilename) => {
      const record = recordsByFilename.get(recordFilename);
      if (record === undefined) {
        throw new DvError({
          code: "internal-plan-mismatch",
          message: `plan named record '${recordFilename}' that records subtool did not list`,
        });
      }
      return record;
    });
    const newSection = renderReleaseSection({
      newVersion: pendingEntry.projectedVersion,
      bump: pendingEntry.bump,
      records: recordsForPackage,
      dateString,
    });
    const changelogPath = resolveOutputPathFromTemplate({
      package: pkg,
      locationTemplate: loadedConfig.changelog.location,
      newVersion: pendingEntry.projectedVersion,
      repoRootPath,
    });
    await upsertChangelogSection({ changelogPath, newSection });
    touchedPaths.push(relative(repoRootPath, changelogPath));

    // Opt-in HISTORY.md — long-form companion document. Off by
    // default; users enable via `history.enabled: true` in
    // .changelog/config.yaml. CHANGELOG bullets stay terse per Keep
    // a Changelog; HISTORY carries the full Record body prose under
    // h3 subsections so agents and humans get the narrative arc
    // behind each version.
    if (loadedConfig.history.enabled) {
      const historySection = renderHistorySection({
        newVersion: pendingEntry.projectedVersion,
        records: recordsForPackage,
        dateString,
      });
      const historyPath = resolveOutputPathFromTemplate({
        package: pkg,
        locationTemplate: loadedConfig.history.location,
        newVersion: pendingEntry.projectedVersion,
        repoRootPath,
      });
      await upsertHistorySection({
        historyPath,
        newSection: historySection,
      });
      touchedPaths.push(relative(repoRootPath, historyPath));
    }
  }

  // Delete the consumed Records (and pruned ones, if --prune).
  const consumedRecordFilenames = new Set<string>();
  for (const pendingEntry of plan.pending) {
    for (const recordFilename of pendingEntry.records) {
      consumedRecordFilenames.add(recordFilename);
    }
  }
  if (options.prune) {
    for (const unresolved of plan.unresolvedReferences) {
      consumedRecordFilenames.add(unresolved.record);
    }
  }
  for (const recordFilename of consumedRecordFilenames) {
    const recordPath = join(recordsPath(repoRootPath), recordFilename);
    await Deno.remove(recordPath);
    touchedPaths.push(relative(repoRootPath, recordPath));
  }

  // Constraint cascade (language.md Algebra §9): for each bumped
  // Package, ask every other discovered Package to rewrite its
  // constraint. Plugins report changed:false when the dependent
  // doesn't carry the dep — that's the documented no-op path.
  //
  // Order matters: this pass MUST run after every invokeWriteVersion
  // above. If a dependent is itself in pending, its own version was
  // already written; the cascade then composes a constraint rewrite
  // on top of the already-bumped manifest.
  const cascadedUpdates = await runCascadePass({
    plan,
    discoveredPackageByName,
    resolvedPluginsByUseString,
    repoRootPath,
  });
  for (const update of cascadedUpdates) {
    touchedPaths.push(update.dependentPath);
  }

  await stageFiles({ repoRootPath, paths: touchedPaths });

  const shouldCommit = loadedConfig.git.autoCommit && !options.noCommit;
  let commitSha: string | null = null;
  if (shouldCommit) {
    const message = renderCommitMessage({
      plan,
      template: loadedConfig.git.commitMessageTemplate,
    });
    const commitResult = await commitChanges({
      repoRootPath,
      message,
      sign: loadedConfig.git.sign,
    });
    commitSha = commitResult.commitSha;
  }

  renderHumanSummary({
    plan,
    commitSha,
    staged: !shouldCommit,
    cascadedUpdates,
    colorEnabled: options.colorEnabled,
  });

  return {
    plan,
    commitSha,
    bumpedPackageCount: plan.pending.length,
    consumedRecordCount: consumedRecordFilenames.size,
    cascadedUpdates,
  };
}

interface RunCascadePassArgs {
  plan: Plan;
  discoveredPackageByName: Map<string, Package>;
  resolvedPluginsByUseString: Map<string, ResolvedPlugin>;
  repoRootPath: string;
}

async function runCascadePass(
  args: RunCascadePassArgs,
): Promise<CascadedUpdate[]> {
  const actualUpdates: CascadedUpdate[] = [];
  for (const pendingEntry of args.plan.pending) {
    for (const constraintUpdate of pendingEntry.constraintUpdates) {
      const dependentPkg = args.discoveredPackageByName.get(
        constraintUpdate.dependent,
      );
      if (dependentPkg === undefined) continue;
      const dependentPlugin = args.resolvedPluginsByUseString.get(
        dependentPkg.plugin,
      );
      if (dependentPlugin === undefined) continue;
      const { changed } = await invokeUpdateDependency({
        repoRootPath: args.repoRootPath,
        pkg: dependentPkg,
        resolvedPlugin: dependentPlugin,
        dependencyName: pendingEntry.package,
        newVersion: parseVersion(pendingEntry.projectedVersion),
        timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
      });
      if (changed) {
        actualUpdates.push({
          bumpedPackage: pendingEntry.package,
          dependent: dependentPkg.name,
          dependentPath: dependentPkg.path,
        });
      }
    }
  }
  return actualUpdates;
}

interface ResolveAllPluginsArgs {
  pluginAssignments: PluginAssignment[];
  repoRootPath: string;
}

async function resolveAllPlugins(
  args: ResolveAllPluginsArgs,
): Promise<Map<string, ResolvedPlugin>> {
  const resolvedPluginsByUseString = new Map<string, ResolvedPlugin>();
  for (const pluginAssignment of args.pluginAssignments) {
    if (resolvedPluginsByUseString.has(pluginAssignment.use)) continue;
    const resolvedPlugin = await resolvePlugin({
      pluginUseString: pluginAssignment.use,
      repoRootPath: args.repoRootPath,
    });
    resolvedPluginsByUseString.set(pluginAssignment.use, resolvedPlugin);
  }
  return resolvedPluginsByUseString;
}

interface ReadAllCurrentVersionsArgs {
  discoveredPackages: Package[];
  resolvedPluginsByUseString: Map<string, ResolvedPlugin>;
  repoRootPath: string;
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
    });
    entries.push({
      packageName: discoveredPackage.name,
      currentVersion,
    });
  }
  return entries;
}

interface ResolveOutputPathFromTemplateArgs {
  package: Package;
  locationTemplate: string;
  newVersion: string;
  repoRootPath: string;
}

function resolveOutputPathFromTemplate(
  args: ResolveOutputPathFromTemplateArgs,
): string {
  const rendered = args.locationTemplate
    .replaceAll("{package}", args.package.name)
    .replaceAll("{package-path}", args.package.path)
    .replaceAll("{version}", args.newVersion);
  return join(args.repoRootPath, rendered);
}

function indexPackagesByName(packages: Package[]): Map<string, Package> {
  const indexed = new Map<string, Package>();
  for (const pkg of packages) indexed.set(pkg.name, pkg);
  return indexed;
}

function indexRecordsByFilename(
  parsedRecords: DvRecord[],
): Map<string, DvRecord> {
  const indexed = new Map<string, DvRecord>();
  for (const record of parsedRecords) indexed.set(record.filename, record);
  return indexed;
}

function countConsumedRecords(args: { plan: Plan; prune: boolean }): number {
  const consumedRecordFilenames = new Set<string>();
  for (const pendingEntry of args.plan.pending) {
    for (const recordFilename of pendingEntry.records) {
      consumedRecordFilenames.add(recordFilename);
    }
  }
  if (args.prune) {
    for (const unresolved of args.plan.unresolvedReferences) {
      consumedRecordFilenames.add(unresolved.record);
    }
  }
  return consumedRecordFilenames.size;
}

function todayDateString(): string {
  const now = new Date();
  const year = now.getUTCFullYear().toString().padStart(4, "0");
  const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = now.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderPlanJson(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

interface RenderHumanPlanArgs {
  plan: Plan;
  colorEnabled: boolean;
}

function renderHumanPlan(args: RenderHumanPlanArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log(`${styler.bold("Plan (dry-run)")}:`);
  for (const pending of args.plan.pending) {
    console.log(
      `  ${styler.bold(pending.package)} ${pending.currentVersion} → ${pending.projectedVersion} (${pending.bump})`,
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
      `${styler.bold("Unresolved references")} (halt without ${styler.cyan(
        "--prune",
      )}):`,
    );
    for (const unresolved of args.plan.unresolvedReferences) {
      console.log(
        `  ${styler.dim(unresolved.record)} → ${unresolved.reference}`,
      );
    }
  }
}

interface RenderHumanSummaryArgs {
  plan: Plan;
  commitSha: string | null;
  staged: boolean;
  cascadedUpdates: CascadedUpdate[];
  colorEnabled: boolean;
}

function renderHumanSummary(args: RenderHumanSummaryArgs): void {
  const styler = makeStyler(args.colorEnabled);
  const bumpedPackageCount = args.plan.pending.length;
  const summaryLines: string[] = [];
  for (const pending of args.plan.pending as PlanPending[]) {
    summaryLines.push(
      `  ${styler.bold(pending.package)} ${pending.currentVersion} → ${pending.projectedVersion} (${pending.bump})`,
    );
  }
  console.log(
    `${styler.bold("✓")} versioned ${bumpedPackageCount} package${
      bumpedPackageCount === 1 ? "" : "s"
    }${args.commitSha ? `, committed ${styler.dim(args.commitSha.slice(0, 7))}` : args.staged ? `, ${styler.dim("staged for review")}` : ""}`,
  );
  for (const line of summaryLines) console.log(line);
  if (args.cascadedUpdates.length > 0) {
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
}

interface Styler {
  bold(text: string): string;
  dim(text: string): string;
  cyan(text: string): string;
}

function makeStyler(colorEnabled: boolean): Styler {
  if (!colorEnabled) {
    return {
      bold: (text) => text,
      dim: (text) => text,
      cyan: (text) => text,
    };
  }
  return {
    bold: (text) => `\x1b[1m${text}\x1b[22m`,
    dim: (text) => `\x1b[2m${text}\x1b[22m`,
    cyan: (text) => `\x1b[36m${text}\x1b[39m`,
  };
}
