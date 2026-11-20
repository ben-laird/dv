import { parseArgs } from "@std/cli/parse-args";
import { type FlagSpec, type FlagsOf, lowerFlagSpec } from "./flag-spec.ts";
import { isFlagToken } from "./flag-token.ts";

/**
 * Why a leaf's argv could not be parsed against its flag map. The leaf's
 * handler turns each case into a typed `CliError` with exit 2.
 */
export type FlagParseError = { kind: "unknown-flag"; flagToken: string };

/**
 * The outcome of {@link parseSubcommandArgv}: the parsed flags and positionals,
 * or the first {@link FlagParseError} found.
 */
export type ParseSubcommandArgvOutcome<
  TFlagMap extends Record<string, FlagSpec>,
> =
  | { ok: true; value: ParsedSubcommandArgv<TFlagMap> }
  | { ok: false; error: FlagParseError };

export interface ParseSubcommandArgvArgs<
  TFlagMap extends Record<string, FlagSpec>,
> {
  flagSpecMap: TFlagMap;
  subcommandArgv: string[];
}

export interface ParsedSubcommandArgv<
  TFlagMap extends Record<string, FlagSpec>,
> {
  flags: FlagsOf<TFlagMap>;
  argv: string[];
}

export function parseSubcommandArgv<TFlagMap extends Record<string, FlagSpec>>(
  args: ParseSubcommandArgvArgs<TFlagMap>,
): ParseSubcommandArgvOutcome<TFlagMap> {
  const lowered = lowerFlagSpec(args.flagSpecMap);
  const subcommandArgv = joinDashValues({
    argv: args.subcommandArgv,
    valueFlags: new Set(lowered.string),
  });
  const unknownFlagTokens: string[] = [];
  const parsed = parseArgs(subcommandArgv, {
    // `_` keeps every positional a string: parseArgs would otherwise turn
    // `007` into 7. The leaf knows its own types, so numbers are its call.
    string: ["_", ...lowered.string],
    boolean: lowered.boolean,
    collect: lowered.collect,
    alias: lowered.alias,
    unknown: (token) => {
      // parseArgs calls this for positionals too, and a lone `-` is one.
      if (isFlagToken(token)) {
        unknownFlagTokens.push(token);
        return false;
      }
      return true;
    },
  });
  const firstUnknownFlagToken = unknownFlagTokens[0];
  if (firstUnknownFlagToken !== undefined) {
    return {
      ok: false,
      error: { kind: "unknown-flag", flagToken: firstUnknownFlagToken },
    };
  }

  // parseArgs collects positionals into `_` and the rest of the keys
  // are declared flags. `_` is typed `(string|number)[]`, but listing it
  // under `string` above means every element is already a string.
  const argv = parsed._.map((token) => String(token));

  // Strip `_` and any aliased single-char keys so `flags` only carries
  // the declared full-name keys.
  const aliasedKeys = new Set(Object.keys(lowered.alias));
  const flagsObject: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "_") continue;
    if (aliasedKeys.has(key)) continue;
    flagsObject[key] = value;
  }
  return {
    ok: true,
    value: { flags: asFlagsOf<TFlagMap>(flagsObject), argv },
  };
}

// The one unchecked step: parseArgs returns an untyped record, and each
// key's value was produced by the parser for that flag's declared kind.
function asFlagsOf<TFlagMap extends Record<string, FlagSpec>>(
  flagsObject: Record<string, unknown>,
): FlagsOf<TFlagMap> {
  return flagsObject as FlagsOf<TFlagMap>;
}

interface JoinDashValuesArgs {
  argv: readonly string[];
  valueFlags: ReadonlySet<string>;
}

// parseArgs reads `--title -` as an empty title plus a word `-` (while
// `-t -` gives "-"): a long flag's spaced value may not start with `-`.
// Joining it as `--title=-` makes the long form match the short one.
function joinDashValues(args: JoinDashValuesArgs): string[] {
  const joined: string[] = [];
  for (let index = 0; index < args.argv.length; index++) {
    const token = args.argv[index] ?? "";
    if (token === "--") {
      joined.push(...args.argv.slice(index));
      break;
    }
    const isDashValue =
      args.argv[index + 1] === "-" &&
      token.startsWith("--") &&
      args.valueFlags.has(token.slice(2));
    if (isDashValue) {
      joined.push(`${token}=-`);
      index++;
      continue;
    }
    joined.push(token);
  }
  return joined;
}
