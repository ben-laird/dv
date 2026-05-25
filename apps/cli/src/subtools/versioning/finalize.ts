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
//   { ok: false, error: "..." }                       — hard failure, aborts before commit
//
// dv only invokes finalize when the plugin's info.supportedOps
// includes it (see PluginInfoCache). Plugins that don't implement
// finalize simply leave it off the list; the op-declaration
// mechanism (info) is the answer to "does this plugin support
// op X?" — no per-response escape hatch needed.

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
  return {
    additionalChangedFiles: validatedResponse.additionalChangedFiles ?? [],
    message: validatedResponse.message,
  };
}
