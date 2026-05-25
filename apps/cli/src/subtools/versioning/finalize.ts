import type { ResolvedPlugin } from "../discovery/resolve.ts";
import { invokeOp, parseFinalizeResponse } from "../plugin/mod.ts";

// Invokes the optional `finalize` plugin Op per specs/plugin-contract.md.
// Fires once per plugin per `dv version` / `dv v1` run, after all
// per-package write-version + cascade update-dependency calls have
// completed but before staging and committing.
//
// Purpose: generated companion files (deno.lock, package-lock.json,
// Cargo.lock, etc.) need to be refreshed after the manifest edits
// so they ship in the same commit. The plugin owns the ecosystem
// knowledge of *which* files those are and *how* to refresh them
// (e.g. `deno install`, `cargo update -p <pkg>`); dv just gathers
// the resulting paths and adds them to the stage.
//
// Plugin response shape (FinalizeResponse):
//   { ok: true }                                      — supported, no extra files
//   { ok: true, additionalChangedFiles: [paths...] }  — paths to stage
//   { ok: true, unsupported: true }                   — plugin doesn't implement finalize
//   { ok: false, error: "..." }                       — hard failure, aborts before commit
//
// The `unsupported: true` escape hatch matters because there's no
// op-declaration mechanism in the plugin contract. dv calls finalize
// on every plugin in the run; plugins that haven't been updated to
// support it can either (a) return unsupported, or (b) exit
// non-zero from an unknown-op default-arm — in which case dv
// surfaces the plugin-exit-nonzero error the same way it would
// for any other op. Recommended plugin pattern: add the case
// explicitly and return unsupported when you have no work to do.

export interface InvokeFinalizeArgs {
  repoRootPath: string;
  resolvedPlugin: ResolvedPlugin;
  // Which packages governed by this plugin bumped this run. The
  // plugin can choose to refresh only those packages' generated
  // files, or to refresh everything; dv doesn't care.
  bumpedPackages: { name: string; path: string; newVersion: string }[];
  // Which command is invoking the op. Lets plugins do
  // command-specific finalize work if they want — for example, a
  // v1 promotion might warrant a stricter lockfile audit than a
  // routine bump. v1 in v1: just informational.
  trigger: "version" | "v1";
  timeoutMs: number;
}

export interface InvokeFinalizeResult {
  // Empty when the plugin returned `unsupported: true` or had no
  // additional files to stage. dv treats either case identically.
  additionalChangedFiles: string[];
  // Pass-through message the plugin may include for the human
  // summary (e.g. "refreshed deno.lock"). Optional; not load-bearing.
  message?: string;
}

export async function invokeFinalize(
  args: InvokeFinalizeArgs,
): Promise<InvokeFinalizeResult> {
  const childEnvironment: Record<string, string> = {
    DV_REPO_ROOT: args.repoRootPath,
    DV_FINALIZE_TRIGGER: args.trigger,
    DV_BUMPED_PACKAGES: JSON.stringify(
      args.bumpedPackages.map((entry) => ({
        name: entry.name,
        path: entry.path,
        new_version: entry.newVersion,
      })),
    ),
    PATH: Deno.env.get("PATH") ?? "",
  };
  const homeDirectory = Deno.env.get("HOME");
  if (homeDirectory) childEnvironment.HOME = homeDirectory;

  const { rawStdout } = await invokeOp({
    resolvedPlugin: args.resolvedPlugin,
    opName: "finalize",
    environmentVariables: childEnvironment,
    timeoutMs: args.timeoutMs,
  });
  const validatedResponse = parseFinalizeResponse({
    rawStdout,
    pluginPath: args.resolvedPlugin.path,
  });
  // unsupported is the documented "no finalize for me" escape;
  // collapse it to the same empty-files result as "supported but
  // nothing to add" so callers branch on one shape.
  if (validatedResponse.unsupported === true) {
    return { additionalChangedFiles: [] };
  }
  return {
    additionalChangedFiles: validatedResponse.additionalChangedFiles ?? [],
    message: validatedResponse.message,
  };
}
