import type { Package } from "../../domain/package.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import type { PluginInfoCache, TracingHooks } from "../plugin/mod.ts";
import { invokeGetDependencies } from "../publishing/get-dependencies.ts";

// Builds the intra-workspace dependency graph by asking each package's
// plugin (via the optional `get-dependencies` Op) which other discovered
// packages it depends on. This is the IO-edge step that lets the *pure*
// buildVersionPlan report only real dependents in `constraintUpdates`
// instead of the full bumped × every-other-package cross product.
//
// Mirrors `computeAwaitingRelease`: the command runs this once (it shells
// out to plugins), then threads the result into buildVersionPlan as a
// lookup so the builder itself stays side-effect-free (Algebra §7).
//
// The Op is optional. A package whose plugin doesn't declare
// `get-dependencies` is omitted from the returned map entirely — callers
// treat "no entry" as "edges unknown" and fall back to the conservative
// cross product for that package, so behavior degrades gracefully rather
// than silently dropping a real dependent.

export interface ComputeDependencyEdgesArgs {
  discoveredPackages: Package[];
  resolvedPluginsByUseString: Map<string, ResolvedPlugin>;
  pluginInfoCache: PluginInfoCache;
  repoRootPath: string;
  timeoutMs: number;
  tracingHooks?: TracingHooks;
}

// packageName → the set of OTHER discovered package names it depends on.
// A package absent from the map has unknown edges (plugin lacks the Op).
export type DependencyEdges = Map<string, Set<string>>;

export async function computeDependencyEdges(
  args: ComputeDependencyEdgesArgs,
): Promise<DependencyEdges> {
  const allPackageNames = args.discoveredPackages.map((pkg) => pkg.name);
  const edges: DependencyEdges = new Map();
  for (const pkg of args.discoveredPackages) {
    const resolvedPlugin = args.resolvedPluginsByUseString.get(pkg.plugin);
    if (resolvedPlugin === undefined) continue;
    const supportsOp =
      args.pluginInfoCache
        .get(pkg.plugin)
        ?.supportedOps.includes("get-dependencies") === true;
    if (!supportsOp) continue;
    const candidateNames = allPackageNames.filter(
      (candidateName) => candidateName !== pkg.name,
    );
    const { dependencyNames } = await invokeGetDependencies({
      repoRootPath: args.repoRootPath,
      pkg,
      resolvedPlugin,
      candidateNames,
      timeoutMs: args.timeoutMs,
      tracingHooks: args.tracingHooks,
    });
    edges.set(pkg.name, new Set(dependencyNames));
  }
  return edges;
}
