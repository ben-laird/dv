import type { Config, PluginAssignment } from "../domain/config.ts";
import type { Package } from "../domain/package.ts";
import type { Version } from "../domain/version.ts";
import { configPath, loadConfig, recordsPath } from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import {
  type ResolvedPlugin,
  resolvePlugin,
} from "../subtools/discovery/resolve.ts";
import { requireRepoRoot } from "../subtools/git/repo-root.ts";
import { listRecords, type RecordsListing } from "../subtools/records/mod.ts";
import { loadRenameLedger, renamesPath } from "../subtools/renames/mod.ts";
import {
  buildVersionPlan,
  invokeReadVersion,
  type PackageCurrentVersionEntry,
  type Plan,
} from "../subtools/versioning/mod.ts";

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
        )} to scaffold .changelog/config.yaml`,
      );
    }
    return { plan: null, configMissing: true };
  }

  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath,
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
  });

  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords: recordsListing.parsedRecords,
    renameLedger,
    packageCurrentVersions,
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
    caughtError instanceof Error &&
    "code" in caughtError &&
    (caughtError as { code: unknown }).code === "config-not-found"
  ) {
    return true;
  }
  return false;
}

interface ReadCurrentVersionsArgs {
  discoveredPackages: Package[];
  pluginAssignments: PluginAssignment[];
  repoRootPath: string;
}

// Reads the current Version of every discovered Package. Plugin handles
// are cached by `use:` string so an assignment claiming N packages
// resolves its plugin once. The cache is local to a single command
// invocation — long-running daemons are out of scope for v1.

export async function readCurrentVersionsForPackages(
  args: ReadCurrentVersionsArgs,
): Promise<PackageCurrentVersionEntry[]> {
  const resolvedPluginsByUseString = new Map<string, ResolvedPlugin>();
  for (const pluginAssignment of args.pluginAssignments) {
    if (!resolvedPluginsByUseString.has(pluginAssignment.use)) {
      const resolvedPlugin = await resolvePlugin({
        pluginUseString: pluginAssignment.use,
        repoRootPath: args.repoRootPath,
      });
      resolvedPluginsByUseString.set(pluginAssignment.use, resolvedPlugin);
    }
  }

  const entries: PackageCurrentVersionEntry[] = [];
  for (const discoveredPackage of args.discoveredPackages) {
    const resolvedPlugin = resolvedPluginsByUseString.get(
      discoveredPackage.plugin,
    );
    if (resolvedPlugin === undefined) continue;
    const currentVersion: Version = await invokeReadVersion({
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

interface RenderHumanStatusArgs {
  plan: Plan;
  discoveredPackages: Package[];
  recordsListing: RecordsListing;
  colorEnabled: boolean;
}

function renderHumanStatus(args: RenderHumanStatusArgs): void {
  const { plan, discoveredPackages, recordsListing, colorEnabled } = args;
  const styler = makeStyler(colorEnabled);

  if (discoveredPackages.length === 0) {
    console.log(styler.dim("no packages tracked"));
    console.log(
      `  configure ${styler.cyan("discovery.plugins")} in ${styler.cyan(
        ".changelog/config.yaml",
      )} to add some.`,
    );
    return;
  }

  if (plan.pending.length === 0 && plan.unresolvedReferences.length === 0) {
    console.log(styler.dim("no pending records"));
    console.log(
      `  ${discoveredPackages.length} package${
        discoveredPackages.length === 1 ? "" : "s"
      } tracked. File one with ${styler.cyan("`dv add`")}.`,
    );
    if (recordsListing.failures.length > 0) {
      renderRecordFailureFooter({
        failureCount: recordsListing.failures.length,
        styler,
      });
    }
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
      `  ${styler.bold(paddedPackageName)}  ${versionTransition}  ${styler.bold(
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
      `${styler.bold("Unresolved references")} — ${plan.unresolvedReferences.length} (halt ${styler.cyan(
        "`dv version`",
      )} unless ${styler.cyan("--prune")}):`,
    );
    for (const unresolvedEntry of plan.unresolvedReferences) {
      console.log(
        `  ${styler.dim(unresolvedEntry.record)} → ${unresolvedEntry.reference}`,
      );
    }
  }

  if (recordsListing.failures.length > 0) {
    renderRecordFailureFooter({
      failureCount: recordsListing.failures.length,
      styler,
    });
  }
}

interface RenderRecordFailureFooterArgs {
  failureCount: number;
  styler: Styler;
}

function renderRecordFailureFooter(args: RenderRecordFailureFooterArgs): void {
  console.log("");
  console.log(
    `${args.styler.dim(
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
