import { parseArgs } from "@std/cli/parse-args";
import { type FlagSpec, type FlagsOf, lowerFlagSpec } from "./flag-spec.ts";
import { isFlagToken } from "./flag-token.ts";

/**
 * Why a leaf's argv could not be parsed against its flag map. The leaf's
 * handler turns each case into a typed `CliError` with exit 2.
 */
export type FlagParseError =
  | { kind: "unknown-flag"; flagToken: string }
  | {
      kind: "invalid-flag-value";
      flagName: string;
      value: string;
      allowedValues: readonly string[];
    };

/**
 * The outcome of {@link parseSubcommandArgv}: the parsed flags and positionals,
 * or the {@link FlagParseError} for the first bad flag in argv order.
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
  const optionalValues = readOptionalValueFlags({
    argv: joinDashValues({
      argv: args.subcommandArgv,
      valueFlags: new Set(lowered.string),
    }),
    flagSpecMap: args.flagSpecMap,
  });
  // parseArgs reports unknown flags in argv order, and each refused
  // optional-value spelling sits in argv as an unknown marker token, so
  // `flagParseErrors` lists every failure in the order it was typed.
  const flagParseErrors: FlagParseError[] = [];
  const parsed = parseArgs(optionalValues.argv, {
    // `_` keeps every positional a string: parseArgs would otherwise turn
    // `007` into 7. The leaf knows its own types, so numbers are its call.
    // Optional-value flags arrive as a name-free placeholder (see
    // readOptionalValueFlags); their real values are set below.
    string: ["_", ...lowered.string, OPTIONAL_VALUE_PLACEHOLDER_KEY],
    boolean: lowered.boolean,
    collect: lowered.collect,
    alias: lowered.alias,
    unknown: (token) => {
      // parseArgs calls this for positionals too, and a lone `-` is one.
      if (isFlagToken(token)) {
        flagParseErrors.push(
          optionalValues.refusals.get(token) ?? {
            kind: "unknown-flag",
            flagToken: token,
          },
        );
        return false;
      }
      return true;
    },
  });
  const firstFlagParseError = flagParseErrors[0];
  if (firstFlagParseError !== undefined) {
    return { ok: false, error: firstFlagParseError };
  }

  // parseArgs collects positionals into `_` and the rest of the keys
  // are declared flags. `_` is typed `(string|number)[]`, but listing it
  // under `string` above means every element is already a string.
  const argv = parsed._.map((token) => String(token));

  // Strip `_`, the placeholder, and any aliased single-char keys so
  // `flags` only carries the declared full-name keys.
  const aliasedKeys = new Set(Object.keys(lowered.alias));
  const flagsObject: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "_") continue;
    if (key === OPTIONAL_VALUE_PLACEHOLDER_KEY) continue;
    if (aliasedKeys.has(key)) continue;
    flagsObject[key] = value;
  }
  for (const [flagName, value] of optionalValues.values) {
    flagsObject[flagName] = value;
  }
  return {
    ok: true,
    value: { flags: asFlagsOf<TFlagMap>(flagsObject), argv },
  };
}

// The one unchecked step: the record holds parseArgs' values for its
// declared kinds plus readOptionalValueFlags' values, each keyed by flag name.
function asFlagsOf<TFlagMap extends Record<string, FlagSpec>>(
  flagsObject: Record<string, unknown>,
): FlagsOf<TFlagMap> {
  return flagsObject as FlagsOf<TFlagMap>;
}

interface ReadOptionalValueFlagsArgs {
  argv: readonly string[];
  flagSpecMap: Record<string, FlagSpec>;
}

interface OptionalValueReading {
  /**
   * argv with each optional-value spelling replaced by the placeholder,
   * and each refused spelling by its refusal marker.
   */
  argv: string[];
  /** Each optional-value flag's last-written value. */
  values: Map<string, boolean | string>;
  /** Refusal marker token → the error it stands for. */
  refusals: Map<string, FlagParseError>;
}

// The key parseArgs sees in place of every optional-value spelling. It
// carries no flag name, so a name with a `no-` prefix or a dot can't be
// misread as a negation or a nested key; the space keeps it off any
// name a CLI would declare.
const OPTIONAL_VALUE_PLACEHOLDER_KEY = "clipc optional value";
const OPTIONAL_VALUE_PLACEHOLDER = `--${OPTIONAL_VALUE_PLACEHOLDER_KEY}=`;
// An undeclared key, so parseArgs hands each marker to `unknown` at its
// place in argv; the attached index keeps markers distinct.
const REFUSAL_MARKER_PREFIX = "--clipc refused flag=";

// parseArgs has no optional attached value: told the flag is a string it
// takes the next word, told it's a boolean it takes a next `true`/`false`.
// So clipc reads `--x`, `--no-x` and `--x=<value>` itself. Each becomes a
// placeholder rather than vanishing, so a preceding `--title` still sees
// a flag next and doesn't swallow the word after it. A refused spelling
// becomes a marker parseArgs reports as unknown, in argv order.
function readOptionalValueFlags(
  args: ReadOptionalValueFlagsArgs,
): OptionalValueReading {
  const declaredValues = new Map<string, readonly string[]>();
  for (const [flagName, flagSpec] of Object.entries(args.flagSpecMap)) {
    if (flagSpec.kind === "optional-value") {
      declaredValues.set(flagName, flagSpec.values);
    }
  }
  const values = new Map<string, boolean | string>();
  const refusals = new Map<string, FlagParseError>();
  const argv: string[] = [];
  for (let index = 0; index < args.argv.length; index++) {
    const token = args.argv[index] ?? "";
    if (token === "--") {
      argv.push(...args.argv.slice(index));
      break;
    }
    const spelling = readOptionalValueSpelling({ token, declaredValues });
    switch (spelling.kind) {
      case "other":
        argv.push(token);
        break;
      case "refused": {
        const marker = `${REFUSAL_MARKER_PREFIX}${refusals.size}`;
        refusals.set(marker, spelling.error);
        argv.push(marker);
        break;
      }
      case "set":
        values.set(spelling.flagName, spelling.value);
        argv.push(OPTIONAL_VALUE_PLACEHOLDER);
        break;
    }
  }
  return { argv, values, refusals };
}

interface ReadOptionalValueSpellingArgs {
  token: string;
  declaredValues: ReadonlyMap<string, readonly string[]>;
}

type OptionalValueSpelling =
  | { kind: "other" }
  | { kind: "set"; flagName: string; value: boolean | string }
  | { kind: "refused"; error: FlagParseError };

// One token against the declared optional-value flags: `--x` is true,
// `--no-x` false, `--x=<value>` that value if declared. `--no-x=<value>`
// is refused here, since parseArgs would quietly read it as `--x=<value>`.
function readOptionalValueSpelling(
  args: ReadOptionalValueSpellingArgs,
): OptionalValueSpelling {
  if (!args.token.startsWith("--")) return { kind: "other" };
  const [name = "", ...attachedParts] = args.token.slice(2).split("=");
  const attached =
    attachedParts.length === 0 ? undefined : attachedParts.join("=");

  const allowedValues = args.declaredValues.get(name);
  if (allowedValues !== undefined) {
    if (attached === undefined) {
      return { kind: "set", flagName: name, value: true };
    }
    if (!allowedValues.includes(attached)) {
      return {
        kind: "refused",
        error: {
          kind: "invalid-flag-value",
          flagName: name,
          value: attached,
          allowedValues,
        },
      };
    }
    return { kind: "set", flagName: name, value: attached };
  }

  const negatedName = name.startsWith("no-") ? name.slice(3) : undefined;
  if (negatedName === undefined || !args.declaredValues.has(negatedName)) {
    return { kind: "other" };
  }
  if (attached !== undefined) {
    return {
      kind: "refused",
      error: { kind: "unknown-flag", flagToken: args.token },
    };
  }
  return { kind: "set", flagName: negatedName, value: false };
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
