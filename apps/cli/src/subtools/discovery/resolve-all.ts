import {
  type PluginAssignment,
  pluginReferenceKey,
} from "../../domain/config.ts";
import { PluginInfoCache, type TracingHooks } from "../plugin/mod.ts";
import { type ResolvedPlugin, resolvePlugin } from "./resolve.ts";

// Shared plugin-resolution prelude for the commands that drive plugins
// (status, version, v1, release). Each used to carry a byte-identical
// private copy of these two functions; this is the single source.

export interface ResolveAllPluginsArgs {
  pluginAssignments: PluginAssignment[];
  repoRootPath: string;
}

// Resolves every distinct plugin reference in the config to a
// ResolvedPlugin, keyed by its canonical reference string. Dedupes
// assignments that share a plugin so we resolve each one once.
export async function resolveAllPlugins(
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

// Eagerly loads info for every plugin in the resolved map, so any
// contract-version mismatch surfaces before per-package ops run.
// Returns the populated cache; callers consult it via
// `.get(pluginKey)?.supportedOps` to gate optional ops.
export async function loadInfoForAllPlugins(args: {
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
