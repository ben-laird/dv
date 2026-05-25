import {
  type Config,
  type PluginAssignment,
  pluginReferenceKey,
} from "../domain/config.ts";
import { DvError } from "../domain/errors.ts";
import type { Package } from "../domain/package.ts";
import type { Version } from "../domain/version.ts";
import { DV_TAGLINE, DV_VERSION } from "../dv-version.ts";
import {
  CONFIG_DIR,
  configPath,
  loadConfig,
  recordsPath,
} from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import {
  type ResolvedPlugin,
  resolvePlugin,
} from "../subtools/discovery/resolve.ts";
import { requireRepoRoot } from "../subtools/git/repo-root.ts";
import type { TracingHooks } from "../subtools/plugin/mod.ts";
import { listRecords, type RecordsListing } from "../subtools/records/mod.ts";
import { loadRenameLedger, renamesPath } from "../subtools/renames/mod.ts";
import { computeAwaitingRelease } from "../subtools/tagging/mod.ts";
import {
  buildVersionPlan,
  invokeReadVersion,
  type PackageCurrentVersionEntry,
  type Plan,
} from "../subtools/versioning/mod.ts";
import { makeStderrTracingHooks } from "./debug-trace.ts";
import { makeStyler, type Styler } from "./styler.ts";

// `dv status` is a read-only preview of `dv version` (specs/cli.md §
// dv status). It shares the Plan builder with `dv version --dry-run` so
// the two outputs cannot disagree by construction (specs/language.md
// Algebra §7).
//
// Fail-soft for malformed Records: a broken Record does not abort, but
// status surfaces the count and points at `dv validate`. Plugin errors
// (e.g. a non-executable plugin, a malformed `read-version` payload) are
// fatal — without a current Version the algebra has nothing to project.

const DEFAULT_FAST_OP_TIMEOUT_MS = 60_000;

export interface RunStatusOptions {
  emitJson: boolean;
  colorEnabled: boolean;
  debug?: boolean;
}

export interface RunStatusResult {
  plan: Plan | null;
  configMissing: boolean;
}

export async function runStatus(
  options: RunStatusOptions,
): Promise<RunStatusResult> {
  const repoRootPath = await requireRepoRoot();
  const configFilePath = configPath(repoRootPath);
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;

  let loadedConfig: Config | null = null;
  try {
    loadedConfig = await loadConfig(configFilePath);
  } catch (caughtError) {
    if (isConfigNotFound(caughtError)) {
      loadedConfig = null;
    } else {
      throw caughtError;
    }
  }
  if (loadedConfig === null) {
    if (options.emitJson) {
      console.log(
        `${JSON.stringify({ error: "config-not-found" }, null, 2)}\n`,
      );
    } else {
      const styler = makeStyler(options.colorEnabled);
      console.log(
        `${styler.dim("no config found")} — run ${styler.cyan(
          "`dv init`",
        )} to scaffold ${CONFIG_DIR}/config.yaml`,
      );
    }
    return { plan: null, configMissing: true };
  }

  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath,
    tracingHooks,
  });
  const recordsListing = await listRecords({
    recordsDirectory: recordsPath(repoRootPath),
  });
  const renameLedger = await loadRenameLedger({
    ledgerPath: renamesPath(repoRootPath),
  });
  const packageCurrentVersions = await readCurrentVersionsForPackages({
    discoveredPackages,
    pluginAssignments: loadedConfig.discovery.plugins,
    repoRootPath,
    tracingHooks,
  });

  // Compute the awaiting-release set via the tagging subtool: per
  // Package, ask git whether the current Version's tag exists.
  // Sorted, byte-stable; first-stable detection rides along.
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
    command: "status",
    discoveredPackages,
    parsedRecords: recordsListing.parsedRecords,
    renameLedger,
    packageCurrentVersions,
    awaitingReleaseLookup,
  });

  if (options.emitJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    renderHumanStatus({
      plan,
      discoveredPackages,
      recordsListing,
      colorEnabled: options.colorEnabled,
    });
  }

  return { plan, configMissing: false };
}

function isConfigNotFound(caughtError: unknown): boolean {
  if (caughtError instanceof Deno.errors.NotFound) return true;
  if (
    caughtError instanceof DvError &&
    caughtError.kind.code === "config-not-found"
  ) {
    return true;
  }
  return false;
}

interface ReadCurrentVersionsArgs {
  discoveredPackages: Package[];
  pluginAssignments: PluginAssignment[];
  repoRootPath: string;
  tracingHooks?: TracingHooks;
}

// Reads the current Version of every discovered Package. Plugin handles
// are cached by `use:` string so an assignment claiming N packages
// resolves its plugin once. The cache is local to a single command
// invocation — long-running daemons are out of scope for v1.

export async function readCurrentVersionsForPackages(
  args: ReadCurrentVersionsArgs,
): Promise<PackageCurrentVersionEntry[]> {
  const resolvedPluginsByKey = new Map<string, ResolvedPlugin>();
  for (const pluginAssignment of args.pluginAssignments) {
    const assignmentKey = pluginReferenceKey(pluginAssignment.use);
    if (!resolvedPluginsByKey.has(assignmentKey)) {
      const resolvedPlugin = await resolvePlugin({
        pluginReference: pluginAssignment.use,
        repoRootPath: args.repoRootPath,
      });
      resolvedPluginsByKey.set(assignmentKey, resolvedPlugin);
    }
  }

  const entries: PackageCurrentVersionEntry[] = [];
  for (const discoveredPackage of args.discoveredPackages) {
    const resolvedPlugin = resolvedPluginsByKey.get(discoveredPackage.plugin);
    if (resolvedPlugin === undefined) continue;
    const currentVersion: Version = await invokeReadVersion({
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

interface RenderHumanStatusArgs {
  plan: Plan;
  discoveredPackages: Package[];
  recordsListing: RecordsListing;
  colorEnabled: boolean;
}

function renderHumanStatus(args: RenderHumanStatusArgs): void {
  const { plan, discoveredPackages, recordsListing, colorEnabled } = args;
  const styler = makeStyler(colorEnabled);

  console.log("");
  // Banner: one styled line at the top of the most-common entry
  // command. Dim so it doesn't compete with the content; suppressed
  // entirely under --json (which doesn't hit this renderer at all)
  // and --no-color (where the dim style would render as plain text
  // and just look like extra noise). NO_COLOR is honored by way of
  // resolveColorEnabled in main.ts flipping colorEnabled to false.
  if (colorEnabled) {
    console.log(
      `${styler.dim(`${styler.bold("dv")}  ${DV_TAGLINE}  v${DV_VERSION}`)}`,
    );
    console.log("");
  }

  if (discoveredPackages.length === 0) {
    console.log(styler.dim("no packages tracked"));
    console.log(
      `  configure ${styler.cyan("discovery.plugins")} in ${styler.cyan(
        `${CONFIG_DIR}/config.yaml`,
      )} to add some.`,
    );
    console.log("");
    return;
  }

  if (plan.pending.length === 0 && plan.unresolvedReferences.length === 0) {
    console.log(styler.dim("no pending records"));
    console.log(`  File one with ${styler.cyan("`dv add`")}.`);
    if (plan.awaitingRelease.length > 0) {
      console.log("");
      renderAwaitingReleaseTable({
        awaitingRelease: plan.awaitingRelease,
        styler,
      });
    }
    if (plan.tracked.length > 0) {
      console.log("");
      renderTrackedTable({ tracked: plan.tracked, styler });
    }
    if (recordsListing.failures.length > 0) {
      renderRecordFailureFooter({
        failureCount: recordsListing.failures.length,
        styler,
      });
    }
    console.log("");
    return;
  }

  const pendingPackageCount = plan.pending.length;
  const totalRecordCount = plan.pending.reduce(
    (runningTotal, entry) => runningTotal + entry.records.length,
    0,
  );
  console.log(
    `${styler.bold("Pending Records")} — ${totalRecordCount} record${
      totalRecordCount === 1 ? "" : "s"
    }, ${pendingPackageCount} package${
      pendingPackageCount === 1 ? "" : "s"
    } (run ${styler.cyan("`dv version`")}):`,
  );
  const packageNameColumnWidth = Math.max(
    ...plan.pending.map((entry) => entry.package.length),
    7,
  );
  const versionColumnWidth = Math.max(
    ...plan.pending.map(
      (entry) => `${entry.currentVersion} → ${entry.projectedVersion}`.length,
    ),
    15,
  );
  for (const pendingEntry of plan.pending) {
    const paddedPackageName = pendingEntry.package.padEnd(
      packageNameColumnWidth,
    );
    const versionTransition =
      `${pendingEntry.currentVersion} → ${pendingEntry.projectedVersion}`.padEnd(
        versionColumnWidth,
      );
    const changeCountSummary = formatChangeCounts(pendingEntry.changeCounts);
    console.log(
      `  ${styler.bold(paddedPackageName)}  ${versionTransition}  ${styler.magenta(
        pendingEntry.bump,
      )}  ${styler.dim(`(${changeCountSummary})`)}`,
    );
    if (pendingEntry.constraintUpdates.length > 0) {
      const dependentNames = pendingEntry.constraintUpdates
        .map((update) => update.dependent)
        .join(", ");
      console.log(
        `       ${styler.dim(`└ would update dependents: ${dependentNames}`)}`,
      );
    }
  }

  if (plan.unresolvedReferences.length > 0) {
    console.log("");
    console.log(
      `${styler.yellow(styler.bold("Unresolved references"))} — ${plan.unresolvedReferences.length} (halt ${styler.cyan(
        "`dv version`",
      )} unless ${styler.cyan("--prune")}):`,
    );
    for (const unresolvedEntry of plan.unresolvedReferences) {
      console.log(
        `  ${styler.dim(unresolvedEntry.record)} → ${unresolvedEntry.reference}`,
      );
    }
  }

  if (plan.awaitingRelease.length > 0) {
    console.log("");
    renderAwaitingReleaseTable({
      awaitingRelease: plan.awaitingRelease,
      styler,
    });
  }

  if (plan.tracked.length > 0) {
    console.log("");
    renderTrackedTable({ tracked: plan.tracked, styler });
  }

  if (recordsListing.failures.length > 0) {
    renderRecordFailureFooter({
      failureCount: recordsListing.failures.length,
      styler,
    });
  }
  console.log("");
}

interface RenderAwaitingReleaseTableArgs {
  awaitingRelease: Plan["awaitingRelease"];
  styler: Styler;
}

function renderAwaitingReleaseTable(
  args: RenderAwaitingReleaseTableArgs,
): void {
  const { awaitingRelease, styler } = args;
  console.log(
    `${styler.bold("Awaiting release")} — ${styler.yellow(
      `${awaitingRelease.length} package${
        awaitingRelease.length === 1 ? "" : "s"
      }`,
    )} (run ${styler.cyan("`dv release`")}):`,
  );
  const nameColumnWidth = Math.max(
    ...awaitingRelease.map((entry) => entry.package.length),
    7,
  );
  const versionColumnWidth = Math.max(
    ...awaitingRelease.map((entry) => entry.version.length),
    5,
  );
  for (const entry of awaitingRelease) {
    const paddedName = entry.package.padEnd(nameColumnWidth);
    const paddedVersion = entry.version.padEnd(versionColumnWidth);
    const firstStableMarker = entry.firstStable
      ? ` ${styler.yellow(styler.bold("(first stable!)"))}`
      : "";
    console.log(
      `  ${styler.bold(paddedName)}  ${paddedVersion}  ${styler.dim(`would tag ${entry.tag}`)}${firstStableMarker}`,
    );
  }
}

interface RenderTrackedTableArgs {
  tracked: Plan["tracked"];
  styler: Styler;
}

function renderTrackedTable(args: RenderTrackedTableArgs): void {
  const { tracked, styler } = args;
  console.log(`${styler.bold("Tracked packages")} — ${tracked.length} total:`);
  const nameColumnWidth = Math.max(
    ...tracked.map((entry) => entry.package.length),
    7,
  );
  const versionColumnWidth = Math.max(
    ...tracked.map((entry) => entry.currentVersion.length),
    5,
  );
  for (const entry of tracked) {
    const paddedName = entry.package.padEnd(nameColumnWidth);
    const paddedVersion = entry.currentVersion.padEnd(versionColumnWidth);
    console.log(
      `  ${styler.bold(paddedName)}  ${paddedVersion}  ${styler.dim(entry.path)}`,
    );
  }
}

interface RenderRecordFailureFooterArgs {
  failureCount: number;
  styler: Styler;
}

function renderRecordFailureFooter(args: RenderRecordFailureFooterArgs): void {
  console.log("");
  console.log(
    `${args.styler.red(
      `${args.failureCount} record file${args.failureCount === 1 ? "" : "s"} failed to parse`,
    )} — run ${args.styler.cyan("`dv validate`")} to see details.`,
  );
}

function formatChangeCounts(changeCounts: {
  feat: number;
  fix: number;
  breaking: number;
}): string {
  const segments: string[] = [];
  if (changeCounts.feat > 0) segments.push(`${changeCounts.feat} feat`);
  if (changeCounts.fix > 0) segments.push(`${changeCounts.fix} fix`);
  if (changeCounts.breaking > 0)
    segments.push(`${changeCounts.breaking} breaking`);
  return segments.join(", ");
}
