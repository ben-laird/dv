import type { PluginAssignment } from "../domain/config.ts";
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
import { invokeRelease } from "../subtools/publishing/mod.ts";
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

  const effectiveDryRun = options.dryRun ?? loadedConfig.safety.dryRunByDefault;
  const effectivePush = options.push ?? loadedConfig.git.autoPush;

  if (!effectiveDryRun && loadedConfig.git.requireCleanTree) {
    await assertCleanTree({ repoRootPath });
  }

  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath,
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
  const workList = buildReleaseWorkList({
    plan,
    force: options.force,
    packagesByName,
    packageCurrentVersions,
    tagFormatTemplate: loadedConfig.tagging.format,
  });

  // Mint tags for entries that don't yet have one. The cascade-pass
  // order (publish-then-push vs push-then-publish) only controls
  // when push happens; minting is always first.
  const mintedTagNames: string[] = [];
  const reusedTagNames: string[] = [];
  for (const entry of workList) {
    const alreadyTagged = await tagExists({
      repoRootPath,
      tag: entry.tag,
    });
    if (alreadyTagged) {
      reusedTagNames.push(entry.tag);
      continue;
    }
    await mintTag({
      repoRootPath,
      tag: entry.tag,
      message: `Release ${entry.tag}`,
      sign: loadedConfig.git.sign,
    });
    mintedTagNames.push(entry.tag);
  }

  const allTagsThisRun = [...mintedTagNames, ...reusedTagNames];
  const pushSequence = loadedConfig.git.pushSequence;
  const pushedTagNames: string[] = [];

  if (effectivePush && pushSequence === "push-then-publish") {
    await pushTags({ repoRootPath, tagNames: allTagsThisRun });
    pushedTagNames.push(...allTagsThisRun);
  }

  const releaseOpOutcomes = await runReleasePhase({
    workList,
    packagesByName,
    resolvedPluginsByUseString,
    repoRootPath,
    timeoutMs: resolvePublishingTimeoutMs(loadedConfig.publishing.timeout),
  });

  if (effectivePush && pushSequence !== "push-then-publish") {
    await pushTags({ repoRootPath, tagNames: allTagsThisRun });
    pushedTagNames.push(...allTagsThisRun);
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
}

async function runReleasePhase(
  args: RunReleasePhaseArgs,
): Promise<ReleaseOpOutcome[]> {
  const outcomes: ReleaseOpOutcome[] = [];
  for (const entry of args.workList) {
    const resolvedPlugin = args.resolvedPluginsByUseString.get(
      entry.pkg.plugin,
    );
    if (resolvedPlugin === undefined) {
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
      });
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
