import { relative } from "@std/path";
import {
  type PluginAssignment,
  type PluginReference,
  pluginReferenceKey,
} from "../domain/config.ts";
import { DvError } from "../domain/errors.ts";
import type { Package } from "../domain/package.ts";
import { configPath, loadConfig } from "../subtools/config/mod.ts";
import { runDiscoveryAssignment } from "../subtools/discovery/mod.ts";
import {
  type ResolvedPlugin,
  resolvePlugin,
} from "../subtools/discovery/resolve.ts";
import { requireRepoRoot } from "../subtools/git/mod.ts";
import type { TracingHooks } from "../subtools/plugin/mod.ts";
import { makeStderrTracingHooks } from "./debug-trace.ts";
import { makeStyler } from "./styler.ts";

// `dv plugin list` — read-only audit answering "did my config wire up
// correctly?" Loads .dv/config.yaml, resolves each plugin assignment,
// runs discovery per-assignment, and shows which packages each
// plugin claims.
//
// No write-side ops fire. Failures are non-fatal per-entry — a plugin
// that can't resolve is surfaced as a row with an error message,
// while other plugins still get listed. This is the spirit of `dv
// status` (read-only preview) applied to the config-plugin seam.
// `dv plugin verify <plugin>` is the deeper, per-plugin contract
// check; `dv plugin list` is the shallower, whole-config audit.

/** Inputs to {@link runPluginList}, mirroring the `dv plugin list` flags. */
export interface RunPluginListOptions {
  /** Emit machine-readable `--json` instead of the human-readable table. */
  emitJson: boolean;
  /** Whether ANSI color is enabled for human-readable output. */
  colorEnabled: boolean;
  /** Emit per-plugin stdio tracing to stderr (`--debug`). */
  debug?: boolean;
}

/** Outcome of auditing one plugin assignment: resolved, or failed to resolve/discover. */
export type PluginListEntryStatus = "ok" | "resolve-failed" | "discover-failed";

/** One plugin assignment's audit result — what it resolved to and which Packages it claims. */
export interface PluginListEntry {
  /** Position of this assignment in the config `plugins` list. */
  assignmentIndex: number;
  /** The plugin {@link PluginReference} this assignment points at. */
  pluginReference: PluginReference;
  /** Stable identity key for {@link PluginListEntry.pluginReference}. */
  pluginReferenceKey: string;
  /** Globs the assignment matches Packages against. */
  matchGlobs: string[];
  /** Whether resolution and discovery succeeded for this assignment. */
  status: PluginListEntryStatus;
  /** Filesystem path the plugin resolved to, when resolution succeeded. */
  resolvedPluginPath?: string;
  /** Kind of the resolved plugin ({@link ResolvedPlugin}), when resolution succeeded. */
  resolvedPluginKind?: ResolvedPlugin["kind"];
  /** Packages this plugin claimed during discovery. */
  packages: Package[];
  /** Stable {@link DvError} code, when this entry failed. */
  errorCode?: string;
  /** Human-readable failure detail, when this entry failed. */
  errorMessage?: string;
}

/** Aggregate result of `dv plugin list`: per-assignment {@link PluginListEntry} rows plus a failure flag. */
export interface RunPluginListResult {
  /** Absolute path of the repository root the audit ran against. */
  repoRootPath: string;
  /** One {@link PluginListEntry} per config plugin assignment. */
  entries: PluginListEntry[];
  /** True if any entry has a non-`ok` {@link PluginListEntryStatus}. */
  hasFailures: boolean;
}

/**
 * Run the `dv plugin list` audit: load config, resolve each plugin assignment,
 * and discover the Packages each claims. Read-only — no write-side plugin ops
 * fire, and per-assignment failures are surfaced as entries rather than thrown.
 */
export async function runPluginList(
  options: RunPluginListOptions,
): Promise<RunPluginListResult> {
  const repoRootPath = await requireRepoRoot();
  const loadedConfig = await loadConfig(configPath(repoRootPath));
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;

  // Resolve and discover each assignment independently so one
  // broken plugin doesn't hide the rest. The whole-config
  // discoverPackages function collapses results across all
  // assignments (and rejects path conflicts); for `plugin list`
  // we want the per-plugin grouping, so we drive
  // runDiscoveryAssignment directly.
  const entries: PluginListEntry[] = [];
  for (
    let assignmentIndex = 0;
    assignmentIndex < loadedConfig.discovery.plugins.length;
    assignmentIndex++
  ) {
    const pluginAssignment = loadedConfig.discovery.plugins[assignmentIndex];
    if (pluginAssignment === undefined) continue;
    entries.push(
      await buildEntry({
        assignmentIndex,
        pluginAssignment,
        repoRootPath,
        tracingHooks,
      }),
    );
  }

  const hasFailures = entries.some((entry) => entry.status !== "ok");

  if (options.emitJson) {
    console.log(
      JSON.stringify(
        {
          schema: "urn:dv:schema:v1:plugin-list-result",
          repoRootPath,
          entries: entries.map((entry) => ({
            assignmentIndex: entry.assignmentIndex,
            pluginReferenceKey: entry.pluginReferenceKey,
            matchGlobs: entry.matchGlobs,
            status: entry.status,
            resolvedPluginPath: entry.resolvedPluginPath ?? null,
            resolvedPluginKind: entry.resolvedPluginKind ?? null,
            packages: entry.packages.map((pkg) => ({
              name: pkg.name,
              path: relative(repoRootPath, pkg.path),
            })),
            errorCode: entry.errorCode ?? null,
            errorMessage: entry.errorMessage ?? null,
          })),
          hasFailures,
        },
        null,
        2,
      ),
    );
  } else {
    renderHumanSummary({
      repoRootPath,
      entries,
      colorEnabled: options.colorEnabled,
    });
  }

  return { repoRootPath, entries, hasFailures };
}

interface BuildEntryArgs {
  assignmentIndex: number;
  pluginAssignment: PluginAssignment;
  repoRootPath: string;
  tracingHooks?: TracingHooks;
}

async function buildEntry(args: BuildEntryArgs): Promise<PluginListEntry> {
  const referenceKey = pluginReferenceKey(args.pluginAssignment.use);
  const matchGlobs = Array.isArray(args.pluginAssignment.match)
    ? args.pluginAssignment.match
    : [args.pluginAssignment.match];

  let resolvedPlugin: ResolvedPlugin;
  try {
    resolvedPlugin = await resolvePlugin({
      pluginReference: args.pluginAssignment.use,
      repoRootPath: args.repoRootPath,
    });
  } catch (caughtError) {
    return {
      assignmentIndex: args.assignmentIndex,
      pluginReference: args.pluginAssignment.use,
      pluginReferenceKey: referenceKey,
      matchGlobs,
      status: "resolve-failed",
      packages: [],
      errorCode:
        caughtError instanceof DvError ? caughtError.kind.code : "unknown",
      errorMessage:
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
    };
  }

  let claimedPackages: Package[] = [];
  try {
    claimedPackages = await runDiscoveryAssignment({
      pluginAssignment: args.pluginAssignment,
      assignmentIndex: args.assignmentIndex,
      repoRootPath: args.repoRootPath,
      tracingHooks: args.tracingHooks,
    });
  } catch (caughtError) {
    return {
      assignmentIndex: args.assignmentIndex,
      pluginReference: args.pluginAssignment.use,
      pluginReferenceKey: referenceKey,
      matchGlobs,
      status: "discover-failed",
      resolvedPluginPath: resolvedPlugin.path,
      resolvedPluginKind: resolvedPlugin.kind,
      packages: [],
      errorCode:
        caughtError instanceof DvError ? caughtError.kind.code : "unknown",
      errorMessage:
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
    };
  }

  return {
    assignmentIndex: args.assignmentIndex,
    pluginReference: args.pluginAssignment.use,
    pluginReferenceKey: referenceKey,
    matchGlobs,
    status: "ok",
    resolvedPluginPath: resolvedPlugin.path,
    resolvedPluginKind: resolvedPlugin.kind,
    packages: claimedPackages,
  };
}

interface RenderHumanSummaryArgs {
  repoRootPath: string;
  entries: PluginListEntry[];
  colorEnabled: boolean;
}

function renderHumanSummary(args: RenderHumanSummaryArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  if (args.entries.length === 0) {
    console.log(
      `${styler.dim("no plugin assignments configured in")} ${styler.cyan(".dv/config.yaml")}`,
    );
    console.log("");
    return;
  }
  console.log(`Plugins (${args.entries.length} configured):`);
  for (const entry of args.entries) {
    console.log("");
    const headline = styler.cyan(entry.pluginReferenceKey);
    const globSummary = styler.dim(`matches: ${entry.matchGlobs.join(", ")}`);
    if (entry.status === "resolve-failed") {
      console.log(
        `  ${styler.red(styler.bold("✗"))} ${headline}  ${globSummary}`,
      );
      console.log(
        `      ${styler.red("resolve failed")}: ${entry.errorMessage ?? ""}`,
      );
      continue;
    }
    if (entry.status === "discover-failed") {
      console.log(
        `  ${styler.red(styler.bold("✗"))} ${headline}  ${globSummary}`,
      );
      console.log(
        `      ${styler.red("discover failed")}: ${entry.errorMessage ?? ""}`,
      );
      continue;
    }
    const packageCount = entry.packages.length;
    const marker =
      packageCount === 0 ? styler.dim("·") : styler.green(styler.bold("✓"));
    console.log(
      `  ${marker} ${headline}  ${styler.dim(
        `${packageCount} package${packageCount === 1 ? "" : "s"}`,
      )}  ${globSummary}`,
    );
    for (const pkg of entry.packages) {
      const relativePackagePath = relative(args.repoRootPath, pkg.path);
      console.log(
        `      ${pkg.name.padEnd(20)} ${styler.dim(relativePackagePath)}`,
      );
    }
  }
  console.log("");
}
