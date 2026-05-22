import type { Package } from "../../domain/package.ts";
import { formatVersion, type Version } from "../../domain/version.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import { invokeOp, parseUpdateDependencyResponse } from "../plugin/mod.ts";
import { buildOpEnvironment } from "./read-version.ts";

// Invokes the `update-dependency` plugin Op per specs/plugin-contract.md.
// Used by `dv version`'s cascade pass: when a Package bumps, every
// other discovered Package is asked to rewrite its constraint on the
// bumped Package. The plugin reports `changed: false` for packages
// that don't carry the dependency — that's success, not failure
// (constraint-only cascading per language.md Algebra §9).
//
// Unlike read-version / write-version, this Op takes its payload via
// stdin JSON, not env vars. The standard env vars (DV_REPO_ROOT,
// DV_PACKAGE_NAME, DV_PACKAGE_PATH) still travel — they describe the
// dependent — and the stdin payload carries the dependency + new
// version. Wire format keys are snake_case per the contract.

export interface InvokeUpdateDependencyArgs {
  repoRootPath: string;
  pkg: Package;
  resolvedPlugin: ResolvedPlugin;
  dependencyName: string;
  newVersion: Version;
  timeoutMs: number;
}

export interface InvokeUpdateDependencyResult {
  changed: boolean;
}

export async function invokeUpdateDependency(
  args: InvokeUpdateDependencyArgs,
): Promise<InvokeUpdateDependencyResult> {
  const childEnvironment = buildOpEnvironment({
    repoRootPath: args.repoRootPath,
    pkg: args.pkg,
  });
  const stdinPayload = JSON.stringify({
    package: args.pkg.name,
    package_path: args.pkg.path,
    dependency: args.dependencyName,
    new_version: formatVersion(args.newVersion),
  });
  const { rawStdout } = await invokeOp({
    resolvedPlugin: args.resolvedPlugin,
    opName: "update-dependency",
    environmentVariables: childEnvironment,
    stdinPayload,
    timeoutMs: args.timeoutMs,
  });
  const validatedResponse = parseUpdateDependencyResponse({
    rawStdout,
    pluginPath: args.resolvedPlugin.path,
  });
  return { changed: validatedResponse.changed };
}
