import type { PluginReference } from "../domain/config.ts";
import { DvError } from "../domain/errors.ts";

// Parse a positional `<plugin>` argument (from `dv plugin invoke`,
// `dv plugin verify`) into a PluginReference — the same discriminated
// union the config uses. Two input shapes:
//
//   1. Explicit prefix: `path:./foo`, `command:my-bin`,
//      `builtin:cargo`, `run:deno run -A ./main.ts`. Wins
//      unambiguously — no shape guessing.
//   2. No prefix: shape-infer. A path-shaped token (`./x`, `../x`,
//      `/x`, `~/x`) routes to `path:`; everything else routes to
//      `command:` (a $PATH lookup). Strings containing whitespace
//      are rejected with a hint to use `run:` explicitly — we don't
//      want to silently mistake `cargo dv` for one $PATH binary.
//
// The point of routing through the same resolver dv's real pipeline
// uses is verification: any change to plugin resolution semantics
// shows up in `dv plugin invoke` automatically. No parallel parser.

export interface ParsePluginPositionalArgs {
  rawPositional: string;
}

export function parsePluginPositional(
  args: ParsePluginPositionalArgs,
): PluginReference {
  const trimmedInput = args.rawPositional.trim();
  if (trimmedInput.length === 0) {
    throw new DvError({
      code: "plugin-not-found",
      message: "plugin argument is empty",
      hint: "pass a plugin reference like `./my-plugin`, `my-binary`, `path:./x`, `command:y`, or `run:deno run -A ./z`",
      context: { pluginReferenceKey: "<empty>" },
    });
  }

  const prefixed = parsePrefixedReference({ trimmedInput });
  if (prefixed !== undefined) return prefixed;

  // No explicit prefix → shape-infer. Whitespace would be ambiguous:
  // is `cargo dv` a single binary named "cargo dv" or `cargo` + arg
  // `dv`? We force the user to spell it out with `run:` rather than
  // guess.
  if (/\s/.test(trimmedInput)) {
    throw new DvError({
      code: "plugin-not-found",
      message: `plugin '${trimmedInput}' contains whitespace — use an explicit prefix to disambiguate`,
      hint: "for an invocation string, write `run:<command...>`; for a binary on $PATH whose name contains spaces, write `command:<name>`",
      context: { pluginReferenceKey: trimmedInput },
    });
  }

  if (looksPathShaped(trimmedInput)) {
    return { path: trimmedInput };
  }
  return { command: trimmedInput };
}

interface ParsePrefixedReferenceArgs {
  trimmedInput: string;
}

function parsePrefixedReference(
  args: ParsePrefixedReferenceArgs,
): PluginReference | undefined {
  // Check the longest prefix first so `run:` isn't mistaken for a
  // truncated keyword. The colon must be followed by at least one
  // character; an empty value reuses the same empty-arg error path
  // the caller handles for `<plugin>`.
  if (args.trimmedInput.startsWith("path:")) {
    return { path: requireNonEmptyAfterPrefix("path", args.trimmedInput) };
  }
  if (args.trimmedInput.startsWith("command:")) {
    return {
      command: requireNonEmptyAfterPrefix("command", args.trimmedInput),
    };
  }
  if (args.trimmedInput.startsWith("builtin:")) {
    return {
      builtin: requireNonEmptyAfterPrefix("builtin", args.trimmedInput),
    };
  }
  if (args.trimmedInput.startsWith("run:")) {
    return { run: requireNonEmptyAfterPrefix("run", args.trimmedInput) };
  }
  return undefined;
}

function requireNonEmptyAfterPrefix(
  prefixName: "path" | "command" | "builtin" | "run",
  trimmedInput: string,
): string {
  const value = trimmedInput.slice(prefixName.length + 1);
  if (value.length === 0) {
    throw new DvError({
      code: "plugin-not-found",
      message: `plugin reference \`${prefixName}:\` has no value`,
      hint: `write the value after the colon, e.g. \`${prefixName}:./my-plugin\``,
      context: { pluginReferenceKey: trimmedInput },
    });
  }
  return value;
}

function looksPathShaped(candidate: string): boolean {
  return (
    candidate.startsWith("./") ||
    candidate.startsWith("../") ||
    candidate.startsWith("/") ||
    candidate.startsWith("~/") ||
    candidate === "~" ||
    candidate.startsWith("~\\") ||
    candidate.includes("/")
  );
}
