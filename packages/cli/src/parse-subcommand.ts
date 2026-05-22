import { parseArgs } from "@std/cli/parse-args";
import type { FlagSpec, FlagsOf, RunnerContext } from "./command-spec.ts";
import { lowerFlagSpec } from "./flag-spec.ts";

// Internal sentinel: an unknown flag (a token starting with `-` that
// isn't declared) becomes this throw, caught by defineCli's dispatch
// and converted to "unknown flag '--foo'" + exit 2. Throwing through
// parseArgs' synchronous `unknown` callback is the structural trick
// that makes the dispatcher testable — previously the equivalent code
// called Deno.exit(2) inline, which is unmockable.

export class UnknownFlagError extends Error {
  constructor(public readonly flagToken: string) {
    super(`unknown flag '${flagToken}'`);
    this.name = "UnknownFlagError";
  }
}

export interface ParseSubcommandArgvArgs<
  TFlagMap extends Record<string, FlagSpec>,
> {
  flagSpecMap: TFlagMap;
  subcommandArgv: string[];
}

export function parseSubcommandArgv<TFlagMap extends Record<string, FlagSpec>>(
  args: ParseSubcommandArgvArgs<TFlagMap>,
): RunnerContext<TFlagMap> {
  const lowered = lowerFlagSpec(args.flagSpecMap);
  const parsed = parseArgs(args.subcommandArgv, {
    string: lowered.string,
    boolean: lowered.boolean,
    collect: lowered.collect,
    alias: lowered.alias,
    unknown: (token) => {
      if (token.startsWith("-")) {
        throw new UnknownFlagError(token);
      }
      return true;
    },
  });

  // parseArgs collects positionals into `_` and the rest of the keys
  // are declared flags. We narrow `_` to string[] (it's `(string|number)[]`
  // by default, but our `unknown` keeps tokens as-is).
  const positionalsRaw = parsed._;
  const argv = positionalsRaw.map((token) => String(token));

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
    flags: flagsObject as FlagsOf<TFlagMap>,
    argv,
  };
}
