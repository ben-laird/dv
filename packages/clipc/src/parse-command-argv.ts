import type { FlagSpec, FlagsOf } from "./flag-spec.ts";
import {
  type FlagParseError,
  parseSubcommandArgv,
} from "./parse-subcommand.ts";
import { validateFlagValues } from "./validate-flags.ts";

// A leaf's argv end to end: the sync lexer, then the async validation step.

/** The arguments to {@link parseCommandArgv}. */
export interface ParseCommandArgvArgs<
  TFlagMap extends Record<string, FlagSpec>,
> {
  flagSpecMap: TFlagMap;
  subcommandArgv: string[];
}

/** A leaf's argv, parsed: typed flags and the positional words. */
export interface ParsedCommandArgv<TFlagMap extends Record<string, FlagSpec>> {
  flags: FlagsOf<TFlagMap>;
  argv: string[];
}

/**
 * The outcome of {@link parseCommandArgv}: the parsed argv, or the
 * {@link FlagParseError} for the first bad flag in argv order.
 */
export type ParseCommandArgvOutcome<TFlagMap extends Record<string, FlagSpec>> =
  | { ok: true; value: ParsedCommandArgv<TFlagMap> }
  | { ok: false; error: FlagParseError };

/**
 * Parses a leaf's argv: lexes it, then validates each flag value. Errors
 * come in argv order, so a value refused before an unknown flag is the one
 * reported.
 */
export async function parseCommandArgv<
  TFlagMap extends Record<string, FlagSpec>,
>(
  args: ParseCommandArgvArgs<TFlagMap>,
): Promise<ParseCommandArgvOutcome<TFlagMap>> {
  const lexed = parseSubcommandArgv(args);
  const validated = await validateFlagValues({
    flagSpecMap: args.flagSpecMap,
    flags: lexed.ok ? lexed.value.flags : {},
    values: lexed.ok ? lexed.value.values : lexed.values,
  });
  if (!validated.ok) return { ok: false, error: validated.error };
  if (!lexed.ok) return { ok: false, error: lexed.error };
  return {
    ok: true,
    value: {
      flags: asFlagsOf<TFlagMap>(validated.flags),
      argv: lexed.value.argv,
    },
  };
}

// The one unchecked step: the record holds the lexer's values for each
// declared flag, with each checked value in place of its raw text, so it
// has the shape FlagsOf computes from the same map.
function asFlagsOf<TFlagMap extends Record<string, FlagSpec>>(
  flags: Record<string, unknown>,
): FlagsOf<TFlagMap> {
  return flags as FlagsOf<TFlagMap>;
}
