import { join, relative } from "@std/path";
import { type PluginAssignment, pluginReferenceKey } from "../domain/config.ts";
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
import { PluginInfoCache, type TracingHooks } from "../subtools/plugin/mod.ts";
import { listRecords } from "../subtools/records/mod.ts";
import { loadRenameLedger, renamesPath } from "../subtools/renames/mod.ts";
import { computeAwaitingRelease } from "../subtools/tagging/mod.ts";
import {
  buildVersionPlan,
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
  // Tri-state: undefined → honor `git.require-clean-tree` config (the
  // default). true → skip the check regardless. false → force the
  // check on even when config says otherwise. The flag pair on the
  // command line is `--allow-dirty` / `--no-allow-dirty`.
  allowDirty?: boolean;
  // True if the tool-wide `--debug` was set; the runner builds a
  // stderr tracing reporter and threads it through every plugin
  // invocation so authors can see exactly what dv asked the plugin.
  // Optional with a default of false so test callers don't have to
  // opt out of tracing every time.
  debug?: boolean;
}

export interface RunVersionResult {
  plan: Plan;
  commitSha: string | null;
  bumpedPackageCount: number;
  consumedRecordCount: number;
  cascadedUpdates: CascadedUpdate[];
  finalizedFiles: FinalizedFile[];
}

// One additional file the finalize pass staged into the version
// commit. Grouped by the plugin that produced it so the human
// summary can name the source ("refreshed deno.lock via the deno
// plugin") rather than dumping a flat list.
export interface FinalizedFile {
  // The canonical plugin reference key (e.g.
  // "run:deno run -A ./examples/plugins/deno/main.ts"), so the
  // summary can de-dupe across packages governed by the same plugin.
  pluginKey: string;
  // Repo-relative path the plugin reported via
  // additionalChangedFiles.
  path: string;
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
  // Built once; passed to every plugin invoker below so the trace
  // reflects the full sequence of ops for one `dv version` run.
  // `undefined` (the default) when --debug wasn't set — the
  // invokers no-op on missing hooks.
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;

  const effectiveDryRun = options.dryRun ?? loadedConfig.safety.dryRunByDefault;

  // Clean-tree gate. The flag wins over config (parity rule):
  //   --allow-dirty       → skip the check
  //   --no-allow-dirty    → force the check on
  //   neither             → honor `git.require-clean-tree`
  // Dry-run skips the check unconditionally — nothing on disk
  // changes in dry mode, so a dirty tree is harmless.
  const effectiveRequireCleanTree =
    options.allowDirty === true
      ? false
      : options.allowDirty === false
        ? true
        : loadedConfig.git.requireCleanTree;
  if (!effectiveDryRun && effectiveRequireCleanTree) {
    await assertCleanTree({ repoRootPath });
  }

  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath,
    tracingHooks,
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
  // Load info for every resolved plugin once, up front. This is
  // where contract-version mismatches surface — we want them BEFORE
  // any per-package op runs, not mid-pipeline.
  const pluginInfoCache = await loadInfoForAllPlugins({
    resolvedPluginsByKey: resolvedPluginsByUseString,
    timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
    tracingHooks,
  });
  const packageCurrentVersions = await readAllCurrentVersions({
    discoveredPackages,
    resolvedPluginsByUseString,
    repoRootPath,
    tracingHooks,
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
      finalizedFiles: [],
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
      finalizedFiles: [],
    };
  }

  // Execute the plan. Indexes for the file IO.
  const discoveredPackageByName = indexPackagesByName(discoveredPackages);
  const recordsByFilename = indexRecordsByFilename(
    recordsListing.parsedRecords,
  );
  const dateString = todayDateString();
  const touchedPaths: string[] = [];

  // Progress reporter — live to stderr in human mode, silent under
  // --json. Column widths are precomputed from the per-package
  // names + known op labels (write-version is the longest) so the
  // lines align across the whole run.
  const versionOpLabels = [
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
        packageColumnWidth: Math.max(
          ...plan.pending.map((entry) => entry.package.length),
          0,
        ),
        operationColumnWidth: Math.max(
          ...versionOpLabels.map((label) => label.length),
          0,
        ),
      });

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
    const writeStep = progressReporter.start({
      packageName: pkg.name,
      operationName: "write-version",
    });
    try {
      await invokeWriteVersion({
        repoRootPath,
        pkg,
        resolvedPlugin,
        newVersion: parseVersion(pendingEntry.projectedVersion),
        timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
        tracingHooks,
      });
      writeStep.done();
    } catch (caughtError) {
      writeStep.fail(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
      throw caughtError;
    }
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
    const changelogStep = progressReporter.start({
      packageName: pkg.name,
      operationName: "changelog",
    });
    try {
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
      // .dv/config.yaml. CHANGELOG bullets stay terse per Keep
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
      changelogStep.done();
    } catch (caughtError) {
      changelogStep.fail(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
      throw caughtError;
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
  const cascadeStep = progressReporter.start({
    packageName: "",
    operationName: "cascade",
  });
  let cascadedUpdates: CascadedUpdate[];
  try {
    cascadedUpdates = await runCascadePass({
      plan,
      discoveredPackageByName,
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

  // Per-plugin finalize pass (specs/plugin-contract.md § finalize).
  // Fires once per plugin that governs a bumped package, AFTER all
  // write-version + cascade update-dependency calls have settled.
  // Lets the plugin refresh generated companion files (deno.lock,
  // package-lock.json, Cargo.lock, etc.) so they ship in the same
  // commit as the manifest edits.
  //
  // Group bumped packages by their governing plugin first so each
  // plugin sees the full set of packages it owns that changed this
  // run (lockfile refresh is naturally a cross-package operation).
  const bumpedPackagesByPluginKey = new Map<
    string,
    { name: string; path: string; newVersion: string }[]
  >();
  for (const pendingEntry of plan.pending) {
    const pkg = discoveredPackageByName.get(pendingEntry.package);
    if (pkg === undefined) continue;
    const existingList = bumpedPackagesByPluginKey.get(pkg.plugin) ?? [];
    existingList.push({
      name: pkg.name,
      path: pkg.path,
      newVersion: pendingEntry.projectedVersion,
    });
    bumpedPackagesByPluginKey.set(pkg.plugin, existingList);
  }
  const finalizedFiles: FinalizedFile[] = [];
  for (const [pluginKey, packagesForPlugin] of bumpedPackagesByPluginKey) {
    const resolvedPlugin = resolvedPluginsByUseString.get(pluginKey);
    if (resolvedPlugin === undefined) {
      throw new DvError({
        code: "internal-plan-mismatch",
        message: `no resolved plugin for '${pluginKey}' during finalize`,
      });
    }
    // Skip plugins that didn't declare `finalize` in info.supportedOps —
    // the op is optional, and invoking it would surface as a
    // plugin-exit-nonzero (or worse, undefined behavior). The
    // info cache was populated up front so this is a pure lookup.
    const pluginInfo = pluginInfoCache.get(pluginKey);
    if (
      pluginInfo === undefined ||
      !pluginInfo.supportedOps.includes("finalize")
    ) {
      continue;
    }
    const finalizeStep = progressReporter.start({
      packageName: "",
      operationName: "finalize",
    });
    try {
      const finalizeResult = await invokeFinalize({
        repoRootPath,
        resolvedPlugin,
        bumpedPackages: packagesForPlugin,
        trigger: "version",
        timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
        tracingHooks,
      });
      for (const additionalFile of finalizeResult.additionalChangedFiles) {
        touchedPaths.push(additionalFile);
        finalizedFiles.push({ pluginKey, path: additionalFile });
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
        prunedUnresolved: options.prune && plan.unresolvedReferences.length > 0,
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
    plan,
    commitSha,
    staged: !shouldCommit,
    cascadedUpdates,
    finalizedFiles,
    colorEnabled: options.colorEnabled,
  });

  return {
    plan,
    commitSha,
    bumpedPackageCount: plan.pending.length,
    consumedRecordCount: consumedRecordFilenames.size,
    cascadedUpdates,
    finalizedFiles,
  };
}

interface RunCascadePassArgs {
  plan: Plan;
  discoveredPackageByName: Map<string, Package>;
  resolvedPluginsByUseString: Map<string, ResolvedPlugin>;
  repoRootPath: string;
  tracingHooks?: TracingHooks;
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
        tracingHooks: args.tracingHooks,
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
  const resolvedPluginsByKey = new Map<string, ResolvedPlugin>();
  for (const pluginAssignment of args.pluginAssignments) {
    const assignmentKey = pluginReferenceKey(pluginAssignment.use);
    if (resolvedPluginsByKey.has(assignmentKey)) continue;
    const resolvedPlugin = await resolvePlugin({
      pluginReference: pluginAssignment.use,
      repoRootPath: args.repoRootPath,
    });
    resolvedPluginsByKey.set(assignmentKey, resolvedPlugin);
  }
  return resolvedPluginsByKey;
}

// Eagerly loads info for every plugin in the resolved map. dv
// version / dv v1 call this right after resolveAllPlugins so any
// contract-version mismatch surfaces before we start invoking
// per-package ops. Returns the populated cache; callers consult
// it via `.get(pluginKey)?.supportedOps` to decide whether to
// invoke optional ops like finalize.
async function loadInfoForAllPlugins(args: {
  resolvedPluginsByKey: Map<string, ResolvedPlugin>;
  timeoutMs: number;
  tracingHooks?: TracingHooks;
}): Promise<PluginInfoCache> {
  const cache = new PluginInfoCache();
  for (const [pluginKey, resolvedPlugin] of args.resolvedPluginsByKey) {
    await cache.getOrLoad({
      pluginKey,
      resolvedPlugin,
      timeoutMs: args.timeoutMs,
      tracingHooks: args.tracingHooks,
    });
  }
  return cache;
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
  console.log("");
  console.log(`${styler.bold("Plan (dry-run)")}:`);
  for (const pending of args.plan.pending) {
    console.log(
      `  ${styler.bold(pending.package)} ${pending.currentVersion} → ${pending.projectedVersion} (${styler.magenta(pending.bump)})`,
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
  plan: Plan;
  commitSha: string | null;
  staged: boolean;
  cascadedUpdates: CascadedUpdate[];
  finalizedFiles: FinalizedFile[];
  colorEnabled: boolean;
}

function renderHumanSummary(args: RenderHumanSummaryArgs): void {
  const styler = makeStyler(args.colorEnabled);
  const bumpedPackageCount = args.plan.pending.length;
  const summaryLines: string[] = [];
  for (const pending of args.plan.pending as PlanPending[]) {
    summaryLines.push(
      `  ${styler.bold(pending.package)} ${pending.currentVersion} → ${pending.projectedVersion} (${styler.magenta(pending.bump)})`,
    );
  }
  console.log("");
  console.log(
    `${styler.green(styler.bold("✓"))} versioned ${bumpedPackageCount} package${
      bumpedPackageCount === 1 ? "" : "s"
    }${args.commitSha ? `, committed ${styler.dim(args.commitSha.slice(0, 7))}` : args.staged ? `, ${styler.dim("staged for review")}` : ""}`,
  );
  for (const line of summaryLines) console.log(line);
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
    console.log(formatFinalizedFilesLine(args.finalizedFiles, styler));
  }
  console.log("");
}

// Emits something like:
//
//   ↳ refreshed 1 file (deno.lock)
//   ↳ refreshed 2 files (deno.lock, Cargo.lock)
//
// The path list is sorted + de-duped so re-runs render the same
// summary regardless of how plugins ordered their additionalChangedFiles
// arrays. We don't show the plugin reference key inline — it's already
// in the per-step "finalize" progress line above the summary, and
// including it twice clutters the typical single-plugin case
// (which is what every dv monorepo with one ecosystem looks like).
function formatFinalizedFilesLine(
  finalizedFiles: FinalizedFile[],
  styler: ReturnType<typeof makeStyler>,
): string {
  const uniquePaths = [
    ...new Set(finalizedFiles.map((entry) => entry.path)),
  ].sort();
  const fileCount = uniquePaths.length;
  const fileWord = fileCount === 1 ? "file" : "files";
  return `  ${styler.dim(
    `↳ refreshed ${fileCount} ${fileWord} (${uniquePaths.join(", ")})`,
  )}`;
}
