import type { Package } from "../../domain/package.ts";
import { parseVersion, type Version } from "../../domain/version.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import { invokeOp, parseReadVersionResponse } from "../plugin/mod.ts";

// Invokes the `read-version` plugin Op per specs/plugin-contract.md.
// Sets the env vars dv promises (DV_REPO_ROOT, DV_PACKAGE_NAME,
// DV_PACKAGE_PATH); parses the response through the Zod schema; surfaces
// any contract violation as PluginError.
//
// A plugin that reports `"0.0.0"` (the documented default for manifests
// without a version field) is returned as a normal Version — the
// versioning subtool treats it as Unstable and lets the algebra do the
// rest. No special-casing of "version-less" packages here.

export interface InvokeReadVersionArgs {
  repoRootPath: string;
  pkg: Package;
  resolvedPlugin: ResolvedPlugin;
  timeoutMs: number;
}

export async function invokeReadVersion(
  args: InvokeReadVersionArgs,
): Promise<Version> {
  const childEnvironment = buildOpEnvironment({
    repoRootPath: args.repoRootPath,
    pkg: args.pkg,
  });
  const { rawStdout } = await invokeOp({
    resolvedPlugin: args.resolvedPlugin,
    opName: "read-version",
    environmentVariables: childEnvironment,
    timeoutMs: args.timeoutMs,
  });
  const validatedResponse = parseReadVersionResponse({
    rawStdout,
    pluginPath: args.resolvedPlugin.path,
  });
  return parseVersion(validatedResponse.version);
}

interface BuildOpEnvironmentArgs {
  repoRootPath: string;
  pkg: Package;
  extra?: Record<string, string>;
}

export function buildOpEnvironment(
  args: BuildOpEnvironmentArgs,
): Record<string, string> {
  const childEnvironment: Record<string, string> = {
    DV_REPO_ROOT: args.repoRootPath,
    DV_PACKAGE_NAME: args.pkg.name,
    DV_PACKAGE_PATH: args.pkg.path,
    PATH: Deno.env.get("PATH") ?? "",
    ...(args.extra ?? {}),
  };
  const homeDirectory = Deno.env.get("HOME");
  if (homeDirectory) childEnvironment.HOME = homeDirectory;
  return childEnvironment;
}
