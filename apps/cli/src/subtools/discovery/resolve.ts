import { isAbsolute, resolve } from "@std/path";
import { DvError } from "../../domain/errors.ts";

// Resolves a plugin `use:` string per specs/config-format.md § Plugin
// resolution.
//
//   ./..., /..., ~/...      → path to executable (relative paths resolve
//                              against the repo root)
//   any other bare string   → builtin name; the registry is empty in v1.

export type ResolvedPlugin =
  | { kind: "single"; path: string }
  | { kind: "dir"; path: string };

interface ResolvePluginArgs {
  pluginUseString: string;
  repoRootPath: string;
}

export async function resolvePlugin(
  args: ResolvePluginArgs,
): Promise<ResolvedPlugin> {
  const { pluginUseString, repoRootPath } = args;
  if (!isPathLike(pluginUseString)) {
    throw new DvError({
      code: "plugin-not-found",
      message: `plugin '${pluginUseString}' is not a path and no builtin with that name ships in v1`,
      hint: "use a path like './plugins/foo' or '/abs/path/to/plugin' in v1",
      context: { pluginUseString },
    });
  }
  const expandedAbsolutePath = expandPath({ pluginUseString, repoRootPath });
  let pluginStat: Deno.FileInfo;
  try {
    pluginStat = await Deno.stat(expandedAbsolutePath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) {
      throw new DvError({
        code: "plugin-not-found",
        message: `plugin not found: ${expandedAbsolutePath}`,
        hint: "check the `use:` path in .changelog/config.yaml is correct and the file exists",
        context: { pluginUseString },
        cause: caughtError,
      });
    }
    throw caughtError;
  }
  return pluginStat.isDirectory
    ? { kind: "dir", path: expandedAbsolutePath }
    : { kind: "single", path: expandedAbsolutePath };
}

function isPathLike(pluginUseString: string): boolean {
  return (
    pluginUseString.startsWith("./") ||
    pluginUseString.startsWith("../") ||
    pluginUseString.startsWith("/") ||
    pluginUseString.startsWith("~/") ||
    pluginUseString === "~"
  );
}

function expandPath(args: ResolvePluginArgs): string {
  const { pluginUseString, repoRootPath } = args;
  let candidatePath = pluginUseString;
  if (candidatePath.startsWith("~/") || candidatePath === "~") {
    const homeDirectory = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
    if (!homeDirectory) {
      throw new DvError({
        code: "plugin-not-found",
        message: `cannot expand '${pluginUseString}': HOME is not set`,
        hint: "set $HOME, or use an absolute path instead of ~/",
        context: { pluginUseString },
      });
    }
    candidatePath =
      candidatePath === "~"
        ? homeDirectory
        : `${homeDirectory}/${candidatePath.slice(2)}`;
  }
  return isAbsolute(candidatePath)
    ? candidatePath
    : resolve(repoRootPath, candidatePath);
}
