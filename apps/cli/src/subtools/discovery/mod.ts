import type { Config, PluginAssignment } from "../../domain/config.ts";
import { ConfigError } from "../../domain/errors.ts";
import type { Package } from "../../domain/package.ts";
import { parseDurationMs } from "./duration.ts";
import { matchesAny, normalizePath, splitMatch } from "./match.ts";
import { invokeOp } from "./plugin-runner.ts";
import { resolvePlugin } from "./resolve.ts";
import { parseDiscoverResponse } from "./response.ts";

const DEFAULT_FAST_OP_TIMEOUT = "60s";

// Drives the discovery Subtool: for each plugin assignment in config,
// invokes its `discover` Op once per positive glob, subtracts negation
// globs, and produces a deduplicated, conflict-checked set of Packages.

interface DiscoverPackagesArgs {
  config: Config;
  repoRootPath: string;
}

export async function discoverPackages(
  args: DiscoverPackagesArgs,
): Promise<Package[]> {
  const { config, repoRootPath } = args;
  const allDiscoveredPackages: Package[] = [];
  const claimedPackagesByPath = new Map<string, Package>();

  for (const [
    assignmentIndex,
    pluginAssignment,
  ] of config.discovery.plugins.entries()) {
    const packagesFromThisAssignment = await runDiscoveryAssignment({
      pluginAssignment,
      assignmentIndex,
      repoRootPath,
    });
    for (const discoveredPackage of packagesFromThisAssignment) {
      const normalizedPackagePath = normalizePath(discoveredPackage.path);
      const previouslyClaimed = claimedPackagesByPath.get(
        normalizedPackagePath,
      );
      if (
        previouslyClaimed &&
        previouslyClaimed.plugin !== discoveredPackage.plugin
      ) {
        throw new ConfigError(
          "package-conflict",
          `package path '${discoveredPackage.path}' is claimed by both '${previouslyClaimed.plugin}' and '${discoveredPackage.plugin}'`,
        );
      }
      if (!previouslyClaimed) {
        claimedPackagesByPath.set(normalizedPackagePath, discoveredPackage);
        allDiscoveredPackages.push(discoveredPackage);
      }
    }
  }
  allDiscoveredPackages.sort((leftPackage, rightPackage) =>
    leftPackage.path.localeCompare(rightPackage.path),
  );
  return allDiscoveredPackages;
}

interface RunDiscoveryAssignmentArgs {
  pluginAssignment: PluginAssignment;
  assignmentIndex: number;
  repoRootPath: string;
}

async function runDiscoveryAssignment(
  args: RunDiscoveryAssignmentArgs,
): Promise<Package[]> {
  const { pluginAssignment, assignmentIndex, repoRootPath } = args;
  const assignmentBreadcrumb = `discovery.plugins[${assignmentIndex}]`;
  const resolvedPlugin = await resolvePlugin({
    pluginUseString: pluginAssignment.use,
    repoRootPath,
  });
  const { positiveGlobs, negativeGlobs } = splitMatch(pluginAssignment.match);
  if (positiveGlobs.length === 0) {
    throw new ConfigError(
      "config-shape",
      `${assignmentBreadcrumb}: 'match' has no positive globs`,
    );
  }
  const opTimeoutMs = parseDurationMs({
    durationString: pluginAssignment.timeout ?? DEFAULT_FAST_OP_TIMEOUT,
    breadcrumb: `${assignmentBreadcrumb}.timeout`,
  });

  const claimedPackages: Package[] = [];
  const seenPackagePaths = new Set<string>();
  for (const positiveGlob of positiveGlobs) {
    const childEnvironment: Record<string, string> = {
      DV_REPO_ROOT: repoRootPath,
      DV_DISCOVER_GLOB: positiveGlob,
      PATH: Deno.env.get("PATH") ?? "",
    };
    const homeDirectory = Deno.env.get("HOME");
    if (homeDirectory) childEnvironment.HOME = homeDirectory;

    const { rawStdout } = await invokeOp({
      resolvedPlugin,
      opName: "discover",
      environmentVariables: childEnvironment,
      timeoutMs: opTimeoutMs,
    });
    const validatedResponse = parseDiscoverResponse({
      rawStdout,
      pluginPath: resolvedPlugin.path,
    });
    for (const discoveredEntry of validatedResponse.packages) {
      const wasExcluded =
        negativeGlobs.length > 0 &&
        matchesAny({
          candidatePath: discoveredEntry.path,
          globs: negativeGlobs,
        });
      if (wasExcluded) continue;
      const normalizedPackagePath = normalizePath(discoveredEntry.path);
      if (seenPackagePaths.has(normalizedPackagePath)) continue;
      seenPackagePaths.add(normalizedPackagePath);
      claimedPackages.push({
        name: discoveredEntry.name,
        path: discoveredEntry.path,
        plugin: pluginAssignment.use,
      });
    }
  }
  return claimedPackages;
}
