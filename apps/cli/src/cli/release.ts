import { type PluginAssignment, pluginReferenceKey } from "../domain/config.ts";
import { DvError } from "../domain/errors.ts";
import type { Package } from "../domain/package.ts";
import { parseVersion } from "../domain/version.ts";
import { configPath, loadConfig } from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import {
  type ResolvedPlugin,
  resolvePlugin,
} from "../subtools/discovery/resolve.ts";
import { assertCleanTree, requireRepoRoot } from "../subtools/git/mod.ts";
import { PluginInfoCache, type TracingHooks } from "../subtools/plugin/mod.ts";
import {
  invokeGetDependencies,
  invokeRelease,
} from "../subtools/publishing/mod.ts";
import { topologicalSort } from "../subtools/publishing/topological-sort.ts";
import {
  computeAwaitingRelease,
  formatTag,
  mintTag,
  pushTags,
  tagExists,
} from "../subtools/tagging/mod.ts";
import {
  buildVersionPlan,
  invokeReadVersion,
  type PackageCurrentVersionEntry,
  type Plan,
} from "../subtools/versioning/mod.ts";
import { makeStderrTracingHooks } from "./debug-trace.ts";
import {
  makeLiveProgressReporter,
  makeSilentProgressReporter,
  type ProgressReporter,
} from "./progress.ts";
import { makeStyler } from "./styler.ts";

// `dv release` per specs/cli.md § dv release. Phase two of the
// release pipeline: mint a per-Package git Tag for every Package
// whose current Version isn't already tagged, invoke each Package's
// release plugin Op, optionally push the tags. Stateless — Tag
// presence is the source of truth (specs/language.md Algebra §4).
//
// Failures in the release Op DO NOT roll back tags
// (specs/plugin-contract.md). Per-package failures aggregate into
// the summary; the run continues. Push failures abort because they
// can leave the remote in a partially-pushed state.

const DEFAULT_FAST_OP_TIMEOUT_MS = 60_000;

export interface RunReleaseOptions {
  // Tri-state: undefined → resolve from `safety.dry-run-by-default`
  // config, then false.
  dryRun?: boolean;
  // Re-run the release Op for already-tagged Packages (failed-publish
  // recovery per specs/cli.md § dv release --force).
  force: boolean;
  // Tri-state: undefined → resolve from `git.auto-push` config.
  push?: boolean;
  yes: boolean;
  emitJson: boolean;
  colorEnabled: boolean;
  // Tri-state: undefined → honor `git.require-clean-tree`. true →
  // skip the check. false → force it on. Flag pair: `--allow-dirty`
  // / `--no-allow-dirty`.
  allowDirty?: boolean;
  debug?: boolean;
}

export interface ReleaseOpOutcome {
  package: string;
  tag: string;
  ok: boolean;
  published?: boolean;
  skipped?: boolean;
  message?: string;
}

export interface RunReleaseResult {
  plan: Plan;
  mintedTagNames: string[];
  reusedTagNames: string[];
  releaseOpOutcomes: ReleaseOpOutcome[];
  pushedTagNames: string[];
}

export async function runRelease(
  options: RunReleaseOptions,
): Promise<RunReleaseResult> {
  const repoRootPath = await requireRepoRoot();
  const configFilePath = configPath(repoRootPath);
  const loadedConfig = await loadConfig(configFilePath);
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;

  const effectiveDryRun = options.dryRun ?? loadedConfig.safety.dryRunByDefault;
  const effectivePush = options.push ?? loadedConfig.git.autoPush;

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
  const resolvedPluginsByUseString = await resolveAllPlugins({
    pluginAssignments: loadedConfig.discovery.plugins,
    repoRootPath,
  });
  // Load plugin info up-front: surfaces contract-version mismatches
  // before any work-side ops run, and tells us which plugins
  // implement the optional `get-dependencies` op for the
  // topological sort below. Cheap (one info call per unique plugin)
  // and matches the pattern in version.ts / v1.ts.
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
    command: "release",
    discoveredPackages,
    parsedRecords: [],
    renameLedger: [],
    packageCurrentVersions,
    awaitingReleaseLookup,
  });

  // Idempotence (Algebra §5): nothing to release and not --force →
  // no-op. With --force, every tracked package becomes a candidate
  // (re-publish already-tagged packages too).
  if (plan.awaitingRelease.length === 0 && !options.force) {
    if (options.emitJson) console.log(JSON.stringify(plan, null, 2));
    else console.log("dv: nothing to release");
    return {
      plan,
      mintedTagNames: [],
      reusedTagNames: [],
      releaseOpOutcomes: [],
      pushedTagNames: [],
    };
  }

  if (effectiveDryRun) {
    if (options.emitJson) console.log(JSON.stringify(plan, null, 2));
    else renderHumanPlan({ plan, colorEnabled: options.colorEnabled });
    return {
      plan,
      mintedTagNames: [],
      reusedTagNames: [],
      releaseOpOutcomes: [],
      pushedTagNames: [],
    };
  }

  assertConfirmedOrYes({
    yes: options.yes,
    plan,
  });

  // Build the per-Package work list. With --force, also include
  // already-tagged Packages (they get their release Op re-run but no
  // new tag is minted).
  const unsortedWorkList = buildReleaseWorkList({
    plan,
    force: options.force,
    packagesByName,
    packageCurrentVersions,
    tagFormatTemplate: loadedConfig.tagging.format,
  });

  // Topologically sort by intra-workspace dependency edges so
  // dependent packages publish *after* the packages they depend on
  // — a hard requirement for registries (JSR, npm) that resolve
  // manifest imports at publish time. Falls back to the input order
  // (alphabetical-by-path from discovery) when no plugin in this
  // run declares get-dependencies, so monorepos with no
  // cross-package deps see unchanged behavior.
  const workList = await sortWorkListByDependencyOrder({
    unsortedWorkList,
    resolvedPluginsByUseString,
    pluginInfoCache,
    repoRootPath,
    tracingHooks,
  });

  // Progress reporter — live to stderr in human mode, silent under
  // --json so machine consumers don't get progress noise on stderr.
  // Column widths are computed from the worklist + known op labels
  // so the lines align across the whole run.
  const releaseOpLabels = ["mint-tag", "release", "push"];
  const progressReporter: ProgressReporter = options.emitJson
    ? makeSilentProgressReporter()
    : makeLiveProgressReporter({
        colorEnabled: options.colorEnabled,
        packageColumnWidth: Math.max(
          ...workList.map((entry) => entry.pkg.name.length),
          0,
        ),
        operationColumnWidth: Math.max(
          ...releaseOpLabels.map((label) => label.length),
          0,
        ),
      });

  // Mint tags for entries that don't yet have one. The cascade-pass
  // order (publish-then-push vs push-then-publish) only controls
  // when push happens; minting is always first.
  const mintedTagNames: string[] = [];
  const reusedTagNames: string[] = [];
  for (const entry of workList) {
    const mintStep = progressReporter.start({
      packageName: entry.pkg.name,
      operationName: "mint-tag",
    });
    try {
      const alreadyTagged = await tagExists({
        repoRootPath,
        tag: entry.tag,
      });
      if (alreadyTagged) {
        reusedTagNames.push(entry.tag);
        mintStep.done();
        continue;
      }
      await mintTag({
        repoRootPath,
        tag: entry.tag,
        message: `Release ${entry.tag}`,
        sign: loadedConfig.git.sign,
      });
      mintedTagNames.push(entry.tag);
      mintStep.done();
    } catch (caughtError) {
      mintStep.fail(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
      throw caughtError;
    }
  }

  const allTagsThisRun = [...mintedTagNames, ...reusedTagNames];
  const pushSequence = loadedConfig.git.pushSequence;
  const pushedTagNames: string[] = [];

  if (effectivePush && pushSequence === "push-then-publish") {
    const pushStep = progressReporter.start({
      packageName: "",
      operationName: "push",
    });
    try {
      await pushTags({ repoRootPath, tagNames: allTagsThisRun });
      pushedTagNames.push(...allTagsThisRun);
      pushStep.done();
    } catch (caughtError) {
      pushStep.fail(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
      throw caughtError;
    }
  }

  const releaseOpOutcomes = await runReleasePhase({
    workList,
    packagesByName,
    resolvedPluginsByUseString,
    repoRootPath,
    timeoutMs: resolvePublishingTimeoutMs(loadedConfig.publishing.timeout),
    progressReporter,
    tracingHooks,
  });

  if (effectivePush && pushSequence !== "push-then-publish") {
    const pushStep = progressReporter.start({
      packageName: "",
      operationName: "push",
    });
    try {
      await pushTags({ repoRootPath, tagNames: allTagsThisRun });
      pushedTagNames.push(...allTagsThisRun);
      pushStep.done();
    } catch (caughtError) {
      pushStep.fail(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
      throw caughtError;
    }
  }

  if (options.emitJson) {
    console.log(
      JSON.stringify(
        {
          plan,
          mintedTagNames,
          reusedTagNames,
          releaseOpOutcomes,
          pushedTagNames,
        },
        null,
        2,
      ),
    );
  } else {
    renderHumanSummary({
      plan,
      mintedTagNames,
      reusedTagNames,
      releaseOpOutcomes,
      pushedTagNames,
      colorEnabled: options.colorEnabled,
    });
  }

  // After the summary has been rendered (so the user sees what
  // succeeded), surface any per-package publish failures as an
  // aggregated CliError. Tags and pushes have already happened —
  // per specs/plugin-contract.md, publish failures do NOT roll back
  // tags. Throwing here is what flips the process exit code and
  // emits the structured `release-partial-failure` envelope; the
  // sub-errors carry one `release-op-failed` per failed package so
  // automation (and `dv release --force` recovery) can target them.
  const failedOutcomes = releaseOpOutcomes.filter((outcome) => !outcome.ok);
  if (failedOutcomes.length > 0) {
    throw new DvError({
      code: "release-partial-failure",
      message: `${failedOutcomes.length} of ${releaseOpOutcomes.length} package(s) failed to publish`,
      hint: "rerun `dv release --force` after addressing each sub-error (tags are already in place)",
      context: {
        failedCount: failedOutcomes.length,
        totalAttempted: releaseOpOutcomes.length,
      },
      subErrors: failedOutcomes.map(
        (outcome) =>
          new DvError({
            code: "release-op-failed",
            message: outcome.message ?? "release op failed",
            context: { package: outcome.package, tag: outcome.tag },
          }),
      ),
    });
  }

  return {
    plan,
    mintedTagNames,
    reusedTagNames,
    releaseOpOutcomes,
    pushedTagNames,
  };
}

interface ReleaseWorkEntry {
  pkg: Package;
  version: string;
  tag: string;
}

interface BuildReleaseWorkListArgs {
  plan: Plan;
  force: boolean;
  packagesByName: Map<string, Package>;
  packageCurrentVersions: PackageCurrentVersionEntry[];
  tagFormatTemplate: string;
}

function buildReleaseWorkList(
  args: BuildReleaseWorkListArgs,
): ReleaseWorkEntry[] {
  if (!args.force) {
    return args.plan.awaitingRelease.flatMap((entry) => {
      const pkg = args.packagesByName.get(entry.package);
      if (pkg === undefined) return [];
      return [{ pkg, version: entry.version, tag: entry.tag }];
    });
  }
  // --force: every tracked Package becomes a candidate. The release
  // Op fires for each; tag-minting is skipped for those already
  // tagged.
  return args.packageCurrentVersions.flatMap((entry) => {
    const pkg = args.packagesByName.get(entry.packageName);
    if (pkg === undefined) return [];
    const versionString = entry.currentVersion;
    const versionText = `${versionString.major}.${versionString.minor}.${versionString.patch}`;
    return [
      {
        pkg,
        version: versionText,
        tag: formatTag({
          package: pkg,
          version: versionText,
          template: args.tagFormatTemplate,
        }),
      },
    ];
  });
}

interface AssertConfirmedOrYesArgs {
  yes: boolean;
  plan: Plan;
}

function assertConfirmedOrYes(args: AssertConfirmedOrYesArgs): void {
  if (args.yes) return;
  const isInteractive = Deno.stdin.isTerminal();
  if (!isInteractive) {
    throw new DvError({
      code: "confirmation-required",
      message: "dv release in a non-TTY context requires --yes to confirm",
      hint: "rerun with --yes to skip the prompt (e.g. in CI)",
    });
  }
  // Built-in Deno prompt — the framework will grow a real prompt
  // subtool in a follow-up. For prototype use this is fine.
  const summaryLine = args.plan.awaitingRelease
    .map((entry) => entry.tag)
    .join(", ");
  const answer = prompt(
    `About to release ${args.plan.awaitingRelease.length} tag(s): ${summaryLine}\nProceed? [y/N]`,
  );
  if (answer !== "y" && answer !== "Y") {
    throw new DvError({
      code: "release-cancelled",
      message: "user declined the release prompt",
    });
  }
}

interface RunReleasePhaseArgs {
  workList: ReleaseWorkEntry[];
  packagesByName: Map<string, Package>;
  resolvedPluginsByUseString: Map<string, ResolvedPlugin>;
  repoRootPath: string;
  timeoutMs?: number;
  progressReporter: ProgressReporter;
  tracingHooks?: TracingHooks;
}

async function runReleasePhase(
  args: RunReleasePhaseArgs,
): Promise<ReleaseOpOutcome[]> {
  const outcomes: ReleaseOpOutcome[] = [];
  for (const entry of args.workList) {
    const releaseStep = args.progressReporter.start({
      packageName: entry.pkg.name,
      operationName: "release",
    });
    const resolvedPlugin = args.resolvedPluginsByUseString.get(
      entry.pkg.plugin,
    );
    if (resolvedPlugin === undefined) {
      releaseStep.fail(`no resolved plugin for '${entry.pkg.plugin}'`);
      outcomes.push({
        package: entry.pkg.name,
        tag: entry.tag,
        ok: false,
        message: `no resolved plugin for '${entry.pkg.plugin}'`,
      });
      continue;
    }
    try {
      const response = await invokeRelease({
        repoRootPath: args.repoRootPath,
        pkg: entry.pkg,
        resolvedPlugin,
        newVersion: parseVersion(entry.version),
        gitTag: entry.tag,
        timeoutMs: args.timeoutMs,
        tracingHooks: args.tracingHooks,
      });
      if (response.ok) {
        releaseStep.done();
      } else {
        releaseStep.fail(response.message);
      }
      outcomes.push({
        package: entry.pkg.name,
        tag: entry.tag,
        ok: response.ok,
        published: response.published,
        skipped: response.skipped,
        message: response.message,
      });
    } catch (caughtError) {
      // Per spec: failures here do not roll back tags. Record the
      // outcome and continue so other Packages still get a chance
      // to publish.
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError);
      releaseStep.fail(message);
      outcomes.push({
        package: entry.pkg.name,
        tag: entry.tag,
        ok: false,
        message,
      });
    }
  }
  return outcomes;
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

// Mirror of version.ts / v1.ts's info loader. Surfaces plugin
// contract-version mismatches before any per-package op runs, and
// populates the cache so the work-list sort below can ask whether
// a plugin declares the optional `get-dependencies` op.
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

interface SortWorkListByDependencyOrderArgs {
  unsortedWorkList: ReleaseWorkEntry[];
  resolvedPluginsByUseString: Map<string, ResolvedPlugin>;
  pluginInfoCache: PluginInfoCache;
  repoRootPath: string;
  tracingHooks?: TracingHooks;
}

// Topologically orders the work list so dependents publish AFTER
// the packages they depend on. The dep graph comes from the
// optional `get-dependencies` plugin op:
//
//   - For each work-list entry whose plugin declares get-dependencies,
//     we invoke it once with `candidates` = every other work-list
//     package's name. The plugin returns the subset it actually
//     depends on.
//   - For entries whose plugin DOESN'T declare the op, we treat
//     them as having no dependencies. They sort to their input
//     position (the alphabetical-by-path fallback), and other
//     packages can still declare dependencies on THEM if those
//     packages' plugins implement the op.
//   - The graph feeds into the pure-function topologicalSort
//     helper; a cycle is a hard error (release-cycle).
//
// Performance: one extra plugin invocation per work-list package
// whose plugin supports the op. For a typical 2–5 package monorepo
// this is fast enough to not matter; for very large workspaces it
// could be worth caching across runs, but that's a future
// optimisation.
async function sortWorkListByDependencyOrder(
  args: SortWorkListByDependencyOrderArgs,
): Promise<ReleaseWorkEntry[]> {
  // Build the candidate list once: every package in the work list.
  // Each plugin call gets EVERY other name, including those whose
  // plugins don't implement the op — the plugin doesn't care
  // whether dv could in principle invoke get-dependencies on a
  // candidate, only whether THIS package's manifest references it.
  const allWorkListNames = args.unsortedWorkList.map((entry) => entry.pkg.name);

  // Per-package: invoke get-dependencies (if supported) and
  // collect the names. Skipping the op when the plugin doesn't
  // claim it is the documented fallback.
  const dependenciesByPackageName = new Map<string, string[]>();
  for (const entry of args.unsortedWorkList) {
    const pluginKey = entry.pkg.plugin;
    const resolvedPlugin = args.resolvedPluginsByUseString.get(pluginKey);
    if (resolvedPlugin === undefined) {
      // Shouldn't happen — the work list came from packages dv
      // discovered, so their plugins should be resolved. Defensive:
      // treat as no deps and let the sort handle it.
      dependenciesByPackageName.set(entry.pkg.name, []);
      continue;
    }
    const pluginInfo = args.pluginInfoCache.get(pluginKey);
    const supportsOp =
      pluginInfo?.supportedOps.includes("get-dependencies") === true;
    if (!supportsOp) {
      dependenciesByPackageName.set(entry.pkg.name, []);
      continue;
    }
    // Other-than-self list. The plugin uses it to scope its match,
    // so it doesn't have to know about the workspace structure.
    const candidateNames = allWorkListNames.filter(
      (candidateName) => candidateName !== entry.pkg.name,
    );
    const { dependencyNames } = await invokeGetDependencies({
      repoRootPath: args.repoRootPath,
      pkg: entry.pkg,
      resolvedPlugin,
      candidateNames,
      timeoutMs: DEFAULT_FAST_OP_TIMEOUT_MS,
      tracingHooks: args.tracingHooks,
    });
    dependenciesByPackageName.set(entry.pkg.name, dependencyNames);
  }

  // Topologically sort the work list. The pure-function helper
  // preserves input position for ties so packages without
  // dependencies still publish in alphabetical-by-path order.
  const sortResult = topologicalSort({
    nodes: args.unsortedWorkList,
    identityOf: (entry) => entry.pkg.name,
    dependenciesOf: (entry) =>
      dependenciesByPackageName.get(entry.pkg.name) ?? [],
  });
  if (sortResult.kind === "cycle") {
    throw new DvError({
      code: "release-cycle",
      message: `cannot order release: dependency cycle detected among ${sortResult.cyclicMembers.join(", ")}`,
      hint: "remove the circular dependency before releasing; cycles can't be safely published to most registries",
      context: { cyclicMembers: sortResult.cyclicMembers },
    });
  }
  return sortResult.ordered;
}

// publishing.timeout is "duration | 'none'"; the runner expects a
// number-of-ms or undefined. Trivial parser; matches the duration
// format from specs/config-format.md.
function resolvePublishingTimeoutMs(timeoutValue: string): number | undefined {
  if (timeoutValue === "none") return undefined;
  const match = timeoutValue.match(/^(\d+)(ms|s|m|h)$/);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
  }
  return undefined;
}

interface RenderHumanPlanArgs {
  plan: Plan;
  colorEnabled: boolean;
}

function renderHumanPlan(args: RenderHumanPlanArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  console.log(`${styler.bold("Plan (dry-run)")}:`);
  for (const entry of args.plan.awaitingRelease) {
    const firstStableMarker = entry.firstStable
      ? ` ${styler.yellow(styler.bold("(first stable!)"))}`
      : "";
    console.log(
      `  ${styler.bold(entry.package)} ${entry.version} → tag ${entry.tag}${firstStableMarker}`,
    );
  }
  console.log("");
}

interface RenderHumanSummaryArgs {
  plan: Plan;
  mintedTagNames: string[];
  reusedTagNames: string[];
  releaseOpOutcomes: ReleaseOpOutcome[];
  pushedTagNames: string[];
  colorEnabled: boolean;
}

function renderHumanSummary(args: RenderHumanSummaryArgs): void {
  const styler = makeStyler(args.colorEnabled);
  const publishedCount = args.releaseOpOutcomes.filter(
    (outcome) => outcome.ok,
  ).length;
  const failedCount = args.releaseOpOutcomes.length - publishedCount;
  const segments: string[] = [`tagged ${args.mintedTagNames.length}`];
  if (args.reusedTagNames.length > 0) {
    segments.push(`reused ${args.reusedTagNames.length}`);
  }
  segments.push(`published ${publishedCount}`);
  if (failedCount > 0) {
    segments.push(`${failedCount} failed`);
  }
  if (args.pushedTagNames.length > 0) {
    segments.push(`pushed ${args.pushedTagNames.length}`);
  }
  console.log("");
  console.log(`${styler.green(styler.bold("✓"))} ${segments.join(", ")}`);

  // First-stable celebration — per Algebra §3 no Record can produce
  // 1.0.0, so a tag at exactly 1.0.0 with no prior history is the
  // moment a Package crosses out of Unstable. Worth noting.
  const firstStableEntries = args.plan.awaitingRelease.filter(
    (entry) => entry.firstStable,
  );
  if (firstStableEntries.length > 0) {
    console.log("");
    for (const entry of firstStableEntries) {
      console.log(
        `  ${styler.yellow(`🎉 ${entry.package} promoted to 1.0.0 — first stable release`)}`,
      );
    }
  }

  const failedOutcomes = args.releaseOpOutcomes.filter(
    (outcome) => !outcome.ok,
  );
  if (failedOutcomes.length > 0) {
    console.log("");
    for (const outcome of failedOutcomes) {
      console.log(
        `  ${styler.red(`✗ ${outcome.package} (${outcome.tag})`)}: ${outcome.message ?? "release op failed"}`,
      );
    }
  }
  console.log("");
}
