import { join } from "@std/path";
import type { Package } from "../../domain/package.ts";
import { formatVersion, type Version } from "../../domain/version.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import {
  invokeOp,
  parseReleaseResponse,
  type ReleaseResponse,
} from "../plugin/mod.ts";
import { buildOpEnvironment } from "../versioning/read-version.ts";

// Invokes the `release` plugin Op per specs/plugin-contract.md.
// Fired by `dv release` after a tag is minted. Env vars set:
// DV_REPO_ROOT, DV_PACKAGE_NAME, DV_PACKAGE_PATH, DV_NEW_VERSION,
// DV_GIT_TAG. No stdin payload.
//
// Two paths that distinguish this from the other invokers:
//
// 1. **Missing release Op file is success.** For directory-style
//    plugins, if `<plugin>/release` does not exist on disk, we
//    return `{ok: true, published: false, message: "no release op"}`
//    synthetically — the package is tagged but has no publish step.
//    Single-executable plugins must handle `release` themselves and
//    return `{ok: true}` if they have no behavior.
//
// 2. **`{ok: false}` is data, not an error.** The release Op is the
//    only one where ok:false is a legitimate response shape:
//    "publish failed but don't roll back the tag." The caller (dv
//    release) aggregates these into a summary and decides exit code.

export interface InvokeReleaseArgs {
  repoRootPath: string;
  pkg: Package;
  resolvedPlugin: ResolvedPlugin;
  newVersion: Version;
  gitTag: string;
  // Publishing timeouts are intentionally separate from fast-op
  // timeouts — `publishing.timeout` defaults to `"none"` because
  // real publish operations (npm publish, deno publish, cargo
  // publish) are legitimately slow and variable. `undefined` here
  // means "no timeout."
  timeoutMs?: number;
}

export async function invokeRelease(
  args: InvokeReleaseArgs,
): Promise<ReleaseResponse> {
  if (args.resolvedPlugin.kind === "dir") {
    const releaseOpPath = join(args.resolvedPlugin.path, "release");
    try {
      await Deno.stat(releaseOpPath);
    } catch (caughtError) {
      if (caughtError instanceof Deno.errors.NotFound) {
        return {
          ok: true,
          published: false,
          message: "no release op",
        };
      }
      throw caughtError;
    }
  }

  const childEnvironment = buildOpEnvironment({
    repoRootPath: args.repoRootPath,
    pkg: args.pkg,
    extra: {
      DV_NEW_VERSION: formatVersion(args.newVersion),
      DV_GIT_TAG: args.gitTag,
    },
  });
  const { rawStdout } = await invokeOp({
    resolvedPlugin: args.resolvedPlugin,
    opName: "release",
    environmentVariables: childEnvironment,
    timeoutMs: args.timeoutMs,
  });
  return parseReleaseResponse({
    rawStdout,
    pluginPath: args.resolvedPlugin.path,
  });
}
