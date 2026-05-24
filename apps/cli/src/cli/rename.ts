import { relative } from "@std/path";
import { type PluginAssignment, pluginReferenceKey } from "../domain/config.ts";
import { DvError } from "../domain/errors.ts";
import { formatVersion } from "../domain/version.ts";
import { configPath, loadConfig } from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import {
  type ResolvedPlugin,
  resolvePlugin,
} from "../subtools/discovery/resolve.ts";
import { requireRepoRoot } from "../subtools/git/mod.ts";
import {
  appendRenameEntry,
  loadRenameLedger,
  renamesPath,
} from "../subtools/renames/mod.ts";
import { invokeReadVersion } from "../subtools/versioning/mod.ts";
import { makeStyler } from "./styler.ts";

// `dv rename <old> <new>` per specs/cli.md § dv rename. Appends a
// lineage edge `old → new` to `.dv/renames.yaml`. Bookkeeping only —
// the user has already renamed the actual package via their ecosystem
// tooling; this command just records the lineage so existing Records
// and release history referencing `old` resolve to `new`.
//
// The ledger entry's `at` field (the new package's first version under
// the new name) is inferred from discovery by default: we run the
// discover/read-version plugin pipeline against `<new>` and use its
// current version. The `--at` flag overrides the inference for cases
// where discovery can't reach the new package yet (e.g. it sits under
// a glob with no plugin assigned, or the user wants to backdate the
// entry).

const DEFAULT_FAST_OP_TIMEOUT_MS = 60_000;

export interface RunRenameOptions {
  fromPackageName: string;
  toPackageName: string;
  atVersionOverride?: string;
  dryRun: boolean;
  emitJson: boolean;
  colorEnabled: boolean;
}

export interface RunRenameResult {
  ledgerPath: string;
  fromPackageName: string;
  toPackageName: string;
  atVersion: string;
  atVersionSource: "inferred" | "override";
  fileCreated: boolean;
  fileWritten: boolean;
}

export async function runRename(
  options: RunRenameOptions,
): Promise<RunRenameResult> {
  const repoRootPath = await requireRepoRoot();
  const ledgerPath = renamesPath(repoRootPath);

  // Detect duplicate-from collisions BEFORE doing any discovery work
  // — discovery may invoke plugins, which is wasted effort if the
  // append is going to fail anyway. The writer also checks, but
  // failing fast here keeps the dry-run preview honest.
  const existingLedger = await loadRenameLedger({ ledgerPath });
  for (const existingEntry of existingLedger) {
    if (existingEntry.from === options.fromPackageName) {
      throw new DvError({
        code: "ledger-duplicate-edge",
        message: `rename ledger already has an outgoing edge from '${options.fromPackageName}' (→ '${existingEntry.to}') — the closure must be functional (one current name per old reference)`,
        hint: `to chain renames, run \`dv rename ${existingEntry.to} ${options.toPackageName}\` instead`,
        context: { ledgerPath, from: options.fromPackageName },
      });
    }
  }

  let atVersion: string;
  let atVersionSource: "inferred" | "override";
  if (options.atVersionOverride !== undefined) {
    atVersion = options.atVersionOverride;
    atVersionSource = "override";
  } else {
    atVersion = await inferAtVersionFromDiscovery({
      toPackageName: options.toPackageName,
      repoRootPath,
    });
    atVersionSource = "inferred";
  }

  if (options.dryRun) {
    if (options.emitJson) {
      console.log(
        JSON.stringify(
          {
            schema: "urn:dv:schema:v1:rename-result",
            ledgerPath,
            fromPackageName: options.fromPackageName,
            toPackageName: options.toPackageName,
            atVersion,
            atVersionSource,
            fileCreated: existingLedger.length === 0,
            fileWritten: false,
            dryRun: true,
          },
          null,
          2,
        ),
      );
    } else {
      renderHumanSummary({
        repoRootPath,
        ledgerPath,
        fromPackageName: options.fromPackageName,
        toPackageName: options.toPackageName,
        atVersion,
        atVersionSource,
        dryRun: true,
        colorEnabled: options.colorEnabled,
      });
    }
    return {
      ledgerPath,
      fromPackageName: options.fromPackageName,
      toPackageName: options.toPackageName,
      atVersion,
      atVersionSource,
      fileCreated: existingLedger.length === 0,
      fileWritten: false,
    };
  }

  const writeResult = await appendRenameEntry({
    ledgerPath,
    fromPackageName: options.fromPackageName,
    toPackageName: options.toPackageName,
    atVersion,
  });

  if (options.emitJson) {
    console.log(
      JSON.stringify(
        {
          schema: "urn:dv:schema:v1:rename-result",
          ledgerPath,
          fromPackageName: options.fromPackageName,
          toPackageName: options.toPackageName,
          atVersion,
          atVersionSource,
          fileCreated: writeResult.fileCreated,
          fileWritten: true,
          dryRun: false,
        },
        null,
        2,
      ),
    );
  } else {
    renderHumanSummary({
      repoRootPath,
      ledgerPath,
      fromPackageName: options.fromPackageName,
      toPackageName: options.toPackageName,
      atVersion,
      atVersionSource,
      dryRun: false,
      colorEnabled: options.colorEnabled,
    });
  }

  return {
    ledgerPath,
    fromPackageName: options.fromPackageName,
    toPackageName: options.toPackageName,
    atVersion,
    atVersionSource,
    fileCreated: writeResult.fileCreated,
    fileWritten: true,
  };
}

interface InferAtVersionArgs {
  toPackageName: string;
  repoRootPath: string;
}

async function inferAtVersionFromDiscovery(
  args: InferAtVersionArgs,
): Promise<string> {
  const loadedConfig = await loadConfig(configPath(args.repoRootPath));
  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath: args.repoRootPath,
  });
  const newPackage = discoveredPackages.find(
    (pkg) => pkg.name === args.toPackageName,
  );
  if (newPackage === undefined) {
    throw new DvError({
      // Reuse `v1-package-not-found` — it's the same shape (a package
      // name the user supplied that discovery can't find) and the
      // `--at` flag's existence is the equivalent of `--prune`: an
      // explicit opt-out from the inference path.
      code: "v1-package-not-found",
      message: `package '${args.toPackageName}' not found in discovered packages — cannot infer \`at\` version`,
      hint: "pass `--at <version>` to record the rename without discovery, or check the `discovery.plugins` glob in your config",
      context: {
        requestedPackage: args.toPackageName,
        knownPackages: discoveredPackages.map((pkg) => pkg.name),
      },
    });
  }

  const resolvedPluginsByKey = await resolveAllPlugins({
    pluginAssignments: loadedConfig.discovery.plugins,
    repoRootPath: args.repoRootPath,
  });
  const newPackagePlugin = resolvedPluginsByKey.get(newPackage.plugin);
  if (newPackagePlugin === undefined) {
    throw new DvError({
      code: "internal-plan-mismatch",
      message: `no resolved plugin for '${newPackage.plugin}'`,
    });
  }
  const currentVersion = await invokeReadVersion({
    repoRootPath: args.repoRootPath,
    pkg: newPackage,
    resolvedPlugin: newPackagePlugin,
    timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
  });
  return formatVersion(currentVersion);
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

interface RenderHumanSummaryArgs {
  repoRootPath: string;
  ledgerPath: string;
  fromPackageName: string;
  toPackageName: string;
  atVersion: string;
  atVersionSource: "inferred" | "override";
  dryRun: boolean;
  colorEnabled: boolean;
}

function renderHumanSummary(args: RenderHumanSummaryArgs): void {
  const styler = makeStyler(args.colorEnabled);
  const relativeLedgerPath = relative(args.repoRootPath, args.ledgerPath);
  const titleVerb = args.dryRun ? "would record" : "recorded";
  const sourceTag =
    args.atVersionSource === "inferred"
      ? styler.dim(" (inferred from discovery)")
      : styler.dim(" (from --at)");
  console.log("");
  console.log(
    `${styler.green(styler.bold("✓"))} ${titleVerb} rename ${styler.cyan(
      args.fromPackageName,
    )} ${styler.dim("→")} ${styler.cyan(args.toPackageName)} ${styler.dim(
      "@",
    )} ${styler.magenta(args.atVersion)}${sourceTag} in ${styler.cyan(
      relativeLedgerPath,
    )}${args.dryRun ? styler.dim(" (dry-run; no file written)") : ""}`,
  );
  console.log("");
}
