import type { Package } from "../../domain/package.ts";
import { formatVersion, type Version } from "../../domain/version.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import { invokeOp, parseWriteVersionResponse } from "../plugin/mod.ts";
import { buildOpEnvironment } from "./read-version.ts";

// Invokes the `write-version` plugin Op per specs/plugin-contract.md.
// Sets the same per-Package env vars as read-version plus DV_NEW_VERSION
// (the SemVer string the plugin should write). The plugin's response is
// just an acknowledgement (`{ ok: true }`); a missing field or a false
// `ok` becomes a PluginError via the shared schema pipeline.
//
// Per the plan-then-execute discipline, this is never called in dry-run
// mode. The caller (the version command) gates the invocation.

export interface InvokeWriteVersionArgs {
  repoRootPath: string;
  pkg: Package;
  resolvedPlugin: ResolvedPlugin;
  newVersion: Version;
  timeoutMs: number;
}

export async function invokeWriteVersion(
  args: InvokeWriteVersionArgs,
): Promise<void> {
  const childEnvironment = buildOpEnvironment({
    repoRootPath: args.repoRootPath,
    pkg: args.pkg,
    extra: { DV_NEW_VERSION: formatVersion(args.newVersion) },
  });
  const { rawStdout } = await invokeOp({
    resolvedPlugin: args.resolvedPlugin,
    opName: "write-version",
    environmentVariables: childEnvironment,
    timeoutMs: args.timeoutMs,
  });
  parseWriteVersionResponse({
    rawStdout,
    pluginPath: args.resolvedPlugin.path,
  });
}
