import { isAbsolute, resolve } from "@std/path";
import type { PluginReference } from "../../domain/config.ts";
import { pluginReferenceKey } from "../../domain/config.ts";
import { DvError } from "../../domain/errors.ts";
import { CONFIG_DIR } from "../config/locations.ts";

// Resolves a plugin reference per specs/config-format.md § Plugin
// resolution. Three arms; the discriminator is the key set on the
// reference object:
//
//   { path: "..." }      → local file or directory. ./, ../, /, ~/
//                          all accepted; relative paths resolve
//                          against repo root.
//   { builtin: "..." }   → first-party plugin from the registry.
//                          v1 ships none; always errors.
//   { command: "..." }   → binary on $PATH. Resolved via PATH
//                          traversal + PATHEXT on Windows.
//
// The pre-1.0 form took a single string with the kind inferred from
// shape (`./...` → path, otherwise → builtin). That overload was
// removed in favor of the discriminated reference; legacy configs
// are intercepted in config/parse.ts and routed to a
// `config-legacy-use-shape` error pointing at `dv migrate config`.

export type ResolvedPlugin =
  | { kind: "single"; path: string }
  | { kind: "dir"; path: string };

interface ResolvePluginArgs {
  pluginReference: PluginReference;
  repoRootPath: string;
}

export function resolvePlugin(
  args: ResolvePluginArgs,
): Promise<ResolvedPlugin> {
  const { pluginReference, repoRootPath } = args;
  if ("path" in pluginReference) {
    return resolvePathReference({
      pathString: pluginReference.path,
      repoRootPath,
      referenceKey: pluginReferenceKey(pluginReference),
    });
  }
  if ("command" in pluginReference) {
    return resolveCommandReference({
      commandName: pluginReference.command,
    });
  }
  // builtin: arm — v1 ships none, so always fails. The same code
  // (`plugin-not-found`) covers this and "path doesn't exist" so
  // consumers branch on one code; the message tells you which arm.
  return Promise.reject(
    new DvError({
      code: "plugin-not-found",
      message: `builtin plugin '${pluginReference.builtin}' is not available — v1 ships no first-party plugins`,
      hint: "use `path:` for a local plugin or `command:` for a binary on $PATH; first-party builtins ship post-v1",
      context: {
        pluginReferenceKey: pluginReferenceKey(pluginReference),
      },
    }),
  );
}

interface ResolvePathReferenceArgs {
  pathString: string;
  repoRootPath: string;
  referenceKey: string;
}

async function resolvePathReference(
  args: ResolvePathReferenceArgs,
): Promise<ResolvedPlugin> {
  const expandedAbsolutePath = expandPath({
    pathString: args.pathString,
    repoRootPath: args.repoRootPath,
    referenceKey: args.referenceKey,
  });
  let pluginStat: Deno.FileInfo;
  try {
    pluginStat = await Deno.stat(expandedAbsolutePath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) {
      throw new DvError({
        code: "plugin-not-found",
        message: `plugin not found: ${expandedAbsolutePath}`,
        hint: `check the \`use.path\` value in ${CONFIG_DIR}/config.yaml is correct and the file exists`,
        context: { pluginReferenceKey: args.referenceKey },
        cause: caughtError,
      });
    }
    throw caughtError;
  }
  return pluginStat.isDirectory
    ? { kind: "dir", path: expandedAbsolutePath }
    : { kind: "single", path: expandedAbsolutePath };
}

interface ResolveCommandReferenceArgs {
  commandName: string;
}

async function resolveCommandReference(
  args: ResolveCommandReferenceArgs,
): Promise<ResolvedPlugin> {
  // Reject path-shaped names early so the user gets a useful error
  // ("you meant path:") instead of a silent PATH miss. The
  // discriminator is the user's intent; we honor it.
  if (
    args.commandName.includes("/") ||
    args.commandName.startsWith("~") ||
    args.commandName.startsWith(".")
  ) {
    throw new DvError({
      code: "plugin-command-not-found",
      message: `command '${args.commandName}' looks like a path; use \`use.path\` instead of \`use.command\` for path-shaped references`,
      hint: "the command: kind is for $PATH lookups only — write `path: <value>` if you mean a local file",
      context: { command: args.commandName },
    });
  }
  const resolvedAbsolutePath = await findOnPath(args.commandName);
  if (resolvedAbsolutePath === undefined) {
    throw new DvError({
      code: "plugin-command-not-found",
      message: `command '${args.commandName}' not found on $PATH`,
      hint: "install the plugin (brew, cargo install, deno install, etc.) or switch to `use.path` if it's a local file",
      context: { command: args.commandName },
    });
  }
  return { kind: "single", path: resolvedAbsolutePath };
}

interface ExpandPathArgs {
  pathString: string;
  repoRootPath: string;
  referenceKey: string;
}

function expandPath(args: ExpandPathArgs): string {
  let candidatePath = args.pathString;
  if (candidatePath.startsWith("~/") || candidatePath === "~") {
    const homeDirectory = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
    if (!homeDirectory) {
      throw new DvError({
        code: "plugin-not-found",
        message: `cannot expand '${args.pathString}': HOME is not set`,
        hint: "set $HOME, or use an absolute path instead of ~/",
        context: { pluginReferenceKey: args.referenceKey },
      });
    }
    candidatePath =
      candidatePath === "~"
        ? homeDirectory
        : `${homeDirectory}/${candidatePath.slice(2)}`;
  }
  return isAbsolute(candidatePath)
    ? candidatePath
    : resolve(args.repoRootPath, candidatePath);
}

// Look up `commandName` on the user's $PATH. Returns the absolute
// path of the first executable match, or undefined if none. Honors
// PATHEXT on Windows so `my-plugin` matches `my-plugin.cmd` /
// `my-plugin.exe` etc. without the caller having to spell out the
// extension.
async function findOnPath(commandName: string): Promise<string | undefined> {
  const pathEnvironmentValue = Deno.env.get("PATH");
  if (pathEnvironmentValue === undefined) return undefined;
  const pathSeparator = Deno.build.os === "windows" ? ";" : ":";
  const directories = pathEnvironmentValue.split(pathSeparator);
  const extensions = computeWindowsExtensions();
  for (const directory of directories) {
    if (directory.length === 0) continue;
    for (const extension of extensions) {
      const candidate = `${directory}/${commandName}${extension}`;
      try {
        const stat = await Deno.stat(candidate);
        if (stat.isFile) return candidate;
      } catch {
        // not found in this directory — try the next
      }
    }
  }
  return undefined;
}

function computeWindowsExtensions(): string[] {
  if (Deno.build.os !== "windows") return [""];
  const pathExtensionsValue = Deno.env.get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  // Try the bare name first (matches a shebang script with no
  // extension), then the PATHEXT-listed alternatives.
  return ["", ...pathExtensionsValue.split(";")];
}
