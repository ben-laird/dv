import type { Package } from "../../domain/package.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import {
  invokeOp,
  parseGetDependenciesResponse,
  type TracingHooks,
} from "../plugin/mod.ts";
import { buildOpEnvironment } from "../versioning/read-version.ts";

// Invokes the `get-dependencies` plugin Op per specs/plugin-contract.md.
// Used by `dv release` to topologically order the work list so
// dependent packages publish *after* the packages they depend on.
//
// The op is optional: dv only invokes it when the plugin's
// info.supportedOps declares it. The release runner gates this call
// behind the info cache, and falls back to alphabetical-by-path
// ordering when the op isn't supported.
//
// stdin carries the candidate list — the names of every *other*
// discovered Package in the workspace. The plugin returns the subset
// that this package depends on. External deps (registry packages
// outside the workspace) are deliberately not part of the response,
// since they don't affect intra-workspace publish ordering.

export interface InvokeGetDependenciesArgs {
  repoRootPath: string;
  pkg: Package;
  resolvedPlugin: ResolvedPlugin;
  // Names of every OTHER discovered package. The plugin returns
  // the subset present in this package's manifest.
  candidateNames: string[];
  timeoutMs: number;
  tracingHooks?: TracingHooks;
}

export interface InvokeGetDependenciesResult {
  dependencyNames: string[];
}

export async function invokeGetDependencies(
  args: InvokeGetDependenciesArgs,
): Promise<InvokeGetDependenciesResult> {
  const childEnvironment = buildOpEnvironment({
    repoRootPath: args.repoRootPath,
    pkg: args.pkg,
  });
  const stdinPayload = JSON.stringify({
    candidates: args.candidateNames,
  });
  const { rawStdout } = await invokeOp({
    resolvedPlugin: args.resolvedPlugin,
    opName: "get-dependencies",
    environmentVariables: childEnvironment,
    stdinPayload,
    timeoutMs: args.timeoutMs,
    tracingHooks: args.tracingHooks,
  });
  const validatedResponse = parseGetDependenciesResponse({
    rawStdout,
    pluginPath: args.resolvedPlugin.path,
  });
  // Defense in depth: the contract says the plugin returns a
  // *subset* of candidates. Filter here so a plugin that
  // accidentally echoes back an external dep can't poison the
  // topological sort with an unknown node.
  const candidateSet = new Set(args.candidateNames);
  return {
    dependencyNames: validatedResponse.dependencies.filter((dependencyName) =>
      candidateSet.has(dependencyName),
    ),
  };
}
