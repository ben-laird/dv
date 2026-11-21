import { parseArgs } from "@std/cli/parse-args";
import {
  type FlagSpec,
  type LoweredFlagSpec,
  lowerFlagSpec,
} from "./flag-spec.ts";
import { isFlagToken } from "./flag-token.ts";
import type { FlagValueIssue, OptionalValueFlagSpec } from "./flag-value.ts";

// The lexer: splits a leaf's argv into flags and positionals, synchronously,
// with every flag value still the raw string typed. What a value means is
// the validation step's job (validate-flags.ts), so lexing can stay sync
// while a schema may be async.

/**
 * Why a leaf's argv could not be parsed against its flag map. The leaf's
 * handler turns each case into a typed `CliError`: exit 2 for what the
 * user typed, exit 1 for a schema that failed. The lexer finds
 * `unknown-flag`; the validation step finds `invalid-flag-value` and
 * `flag-schema-failed`.
 */
export type FlagParseError =
  | { kind: "unknown-flag"; flagToken: string }
  | {
      kind: "invalid-flag-value";
      flagName: string;
      value: string;
      /** Which of a `collect` flag's values was refused, counting from 1. */
      element?: number;
      /** Why the value was refused; never empty. */
      issues: readonly [FlagValueIssue, ...FlagValueIssue[]];
      /** The accepted set, when the flag declares a closed one. */
      allowedValues?: readonly string[];
    }
  | {
      kind: "flag-schema-failed";
      flagName: string;
      value: string;
      /** Which of a `collect` flag's values it was checking, counting from 1. */
      element?: number;
      /** What the schema threw, as text. */
      message: string;
    };

/** A flag the lexer could not read at all. */
export type FlagLexError = Extract<FlagParseError, { kind: "unknown-flag" }>;

/**
 * One raw value typed for a value-carrying flag, at its place in argv.
 * `slot` says where the validated value goes: it is the flag's value, one
 * element of a `collect` flag's list, or an earlier value of a `string` or
 * optional-value flag that a later one overrode (still checked, as typed).
 */
export interface FlagValueReading {
  flagName: string;
  raw: string;
  slot:
    | { kind: "value" }
    | { kind: "element"; index: number }
    | { kind: "overridden" };
}

/**
 * The lexed argv: flags with raw values, positionals, and every value to
 * validate in argv order.
 */
export interface LexedSubcommandArgv {
  /** Declared flag name → its raw value (`boolean`, `string` or `string[]`). */
  flags: Record<string, unknown>;
  /** Positional words, each exactly as typed. */
  argv: string[];
  /** Each value-carrying flag's raw values, in the order they were typed. */
  values: readonly FlagValueReading[];
}

/**
 * The outcome of {@link parseSubcommandArgv}. A failure carries the first
 * bad flag in argv order, with the values typed before it: validating those
 * first keeps errors reported in the order they were typed.
 */
export type ParseSubcommandArgvOutcome =
  | { ok: true; value: LexedSubcommandArgv }
  | {
      ok: false;
      error: FlagLexError;
      /** The values typed before the bad flag, in argv order. */
      values: readonly FlagValueReading[];
    };

export interface ParseSubcommandArgvArgs {
  flagSpecMap: Record<string, FlagSpec>;
  subcommandArgv: string[];
}

export function parseSubcommandArgv(
  args: ParseSubcommandArgvArgs,
): ParseSubcommandArgvOutcome {
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
  // `flagLexErrors` lists every failure in the order it was typed.
  const flagLexErrors: PositionedLexError[] = [];
  const locateToken = tokenLocator(optionalValues.argv);
  const parsed = parseArgs(optionalValues.argv, {
    // `_` keeps every positional a string: parseArgs would otherwise turn
    // `007` into 7. The leaf knows its own types, so numbers are its call.
    // Optional-value flags arrive as a name-free placeholder (see
    // readOptionalValueFlags); their real values are set below.
    string: ["_", ...lowered.string, OPTIONAL_VALUE_PLACEHOLDER_KEY],
    boolean: lowered.boolean,
    // Every value flag is collected, string flags too, so each value typed
    // reaches validation; a string flag's own value is its last one.
    collect: lowered.string,
    alias: lowered.alias,
    unknown: (token) => {
      // parseArgs calls this for positionals too, and a lone `-` is one.
      if (isFlagToken(token)) {
        flagLexErrors.push({
          position: locateToken(token),
          error: optionalValues.refusals.get(token) ?? {
            kind: "unknown-flag",
            flagToken: token,
          },
        });
        return false;
      }
      return true;
    },
  });

  // parseArgs collects positionals into `_` and the rest of the keys
  // are declared flags. `_` is typed `(string|number)[]`, but listing it
  // under `string` above means every element is already a string.
  const argv = parsed._.map((token) => String(token));

  // Strip `_`, the placeholder, and any aliased single-char keys so
  // `flags` only carries the declared full-name keys.
  const aliasedKeys = new Set(Object.keys(lowered.alias));
  const flags: Record<string, unknown> = {};
  const collectFlags = new Set(lowered.collect);
  const typedValues = new Map<string, string[]>();
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "_") continue;
    if (key === OPTIONAL_VALUE_PLACEHOLDER_KEY) continue;
    if (aliasedKeys.has(key)) continue;
    if (!Array.isArray(value)) {
      flags[key] = value;
      continue;
    }
    const typed = value.map((element: unknown) => String(element));
    typedValues.set(key, typed);
    if (collectFlags.has(key)) {
      flags[key] = typed;
      continue;
    }
    // An absent string flag stays absent, not an empty list.
    const lastTyped = typed.at(-1);
    if (lastTyped !== undefined) flags[key] = lastTyped;
  }
  for (const [flagName, value] of optionalValues.values) {
    flags[flagName] = value;
  }
  const positionedValues = [
    ...valueReadings({ typedValues, lowered, argv: optionalValues.argv }),
    ...optionalValues.readings,
  ].sort((left, right) => left.position - right.position);

  const firstLexError = flagLexErrors[0];
  if (firstLexError !== undefined) {
    const valuesBefore = positionedValues.filter((positioned) => {
      return positioned.position < firstLexError.position;
    });
    return {
      ok: false,
      error: firstLexError.error,
      values: readingsOf(valuesBefore),
    };
  }
  return {
    ok: true,
    value: { flags, argv, values: readingsOf(positionedValues) },
  };
}

interface PositionedLexError {
  position: number;
  error: FlagLexError;
}

interface PositionedReading {
  position: number;
  reading: FlagValueReading;
}

function readingsOf(
  positioned: readonly PositionedReading[],
): FlagValueReading[] {
  return positioned.map((entry) => entry.reading);
}

// parseArgs hands `unknown` the whole token it is reading, left to right,
// so each refused token is found by scanning forward from the last one. A
// short cluster (`-xy`) can refuse twice at one place, so the cursor stays.
function tokenLocator(argv: readonly string[]): (token: string) => number {
  let cursor = 0;
  return (token) => {
    const found = argv.indexOf(token, cursor);
    if (found === -1) return argv.length;
    cursor = found;
    return found;
  };
}

interface ValueReadingsArgs {
  /** Each `string` / `collect` flag → every value typed for it, in order. */
  typedValues: ReadonlyMap<string, readonly string[]>;
  lowered: LoweredFlagSpec;
  /** The argv parseArgs read, so positions match the optional-value ones. */
  argv: readonly string[];
}

// The raw values parseArgs read for `string` and `collect` flags, each at
// the place it was typed: the n-th value at the n-th token naming the flag.
function valueReadings(args: ValueReadingsArgs): PositionedReading[] {
  const mentions = flagMentions(args);
  const collectFlags = new Set(args.lowered.collect);
  const readings: PositionedReading[] = [];
  for (const [flagName, typed] of args.typedValues) {
    const positions = mentions.get(flagName) ?? [];
    for (const [index, raw] of typed.entries()) {
      readings.push({
        position: positions[index] ?? args.argv.length,
        reading: {
          flagName,
          raw,
          slot: valueSlot({
            index,
            isCollect: collectFlags.has(flagName),
            isLast: index === typed.length - 1,
          }),
        },
      });
    }
  }
  return readings;
}

interface ValueSlotArgs {
  index: number;
  isCollect: boolean;
  isLast: boolean;
}

// A collect flag's every value is an element; a string flag's last value
// is its value, and each earlier one was overridden but is still checked.
function valueSlot(args: ValueSlotArgs): FlagValueReading["slot"] {
  if (args.isCollect) return { kind: "element", index: args.index };
  return args.isLast ? { kind: "value" } : { kind: "overridden" };
}

// Each value-carrying flag → the argv indexes of the tokens that name it:
// `--name`, `--name=…`, or a short cluster holding its alias letter. Only
// these place values in argv order; parseArgs still reads the values.
function flagMentions(args: ValueReadingsArgs): Map<string, number[]> {
  const valueFlags = new Set(args.lowered.string);
  const mentions = new Map<string, number[]>();
  const mention = (flagName: string, index: number): void => {
    const indexes = mentions.get(flagName) ?? [];
    if (indexes.at(-1) !== index) indexes.push(index);
    mentions.set(flagName, indexes);
  };
  for (const [index, token] of args.argv.entries()) {
    if (token === "--") break;
    if (!isFlagToken(token)) continue;
    if (token.startsWith("--")) {
      const [name = ""] = token.slice(2).split("=");
      if (valueFlags.has(name)) mention(name, index);
      continue;
    }
    const [letters = ""] = token.slice(1).split("=");
    for (const letter of letters) {
      const flagName = args.lowered.alias[letter];
      if (flagName !== undefined && valueFlags.has(flagName)) {
        mention(flagName, index);
      }
    }
  }
  return mentions;
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
  /** Each optional-value flag's last-written value, still raw. */
  values: Map<string, boolean | string>;
  /** Each attached `--x=<raw>`, at its place in argv. */
  readings: PositionedReading[];
  /** Refusal marker token → the error it stands for. */
  refusals: Map<string, FlagLexError>;
}

// The key parseArgs sees in place of every optional-value spelling. It
// carries no flag name, so a name with a `no-` prefix or a dot can't be
// misread as a negation or a nested key; the space keeps it off any
// name a CLI would declare.
const OPTIONAL_VALUE_PLACEHOLDER_KEY = "clipc optional value";
const OPTIONAL_VALUE_PLACEHOLDER = `--${OPTIONAL_VALUE_PLACEHOLDER_KEY}=`;
// An undeclared key, so parseArgs hands each marker to `unknown` at its
// place in argv; the attached index keeps markers distinct.
const REFUSAL_MARKER_KEY = "clipc refused flag";
const REFUSAL_MARKER_PREFIX = `--${REFUSAL_MARKER_KEY}=`;
// A user may type either key; such a token is refused before rewriting so
// it can't pose as a placeholder or a marker.
const RESERVED_FLAG_KEYS: ReadonlySet<string> = new Set([
  OPTIONAL_VALUE_PLACEHOLDER_KEY,
  REFUSAL_MARKER_KEY,
]);

// parseArgs has no optional attached value: told the flag is a string it
// takes the next word, told it's a boolean it takes a next `true`/`false`.
// So clipc reads `--x`, `--no-x` and `--x=<value>` itself. Each becomes a
// placeholder rather than vanishing, so a preceding `--title` still sees
// a flag next and doesn't swallow the word after it. A refused spelling
// becomes a marker parseArgs reports as unknown, in argv order.
function readOptionalValueFlags(
  args: ReadOptionalValueFlagsArgs,
): OptionalValueReading {
  const optionalValueSpecs = new Map<string, OptionalValueFlagSpec>();
  for (const [flagName, flagSpec] of Object.entries(args.flagSpecMap)) {
    if (flagSpec.kind === "optional-value") {
      optionalValueSpecs.set(flagName, flagSpec);
    }
  }
  const values = new Map<string, boolean | string>();
  const attached: { position: number; flagName: string; raw: string }[] = [];
  const lastSpellingAt = new Map<string, number>();
  const refusals = new Map<string, FlagLexError>();
  const argv: string[] = [];
  for (let index = 0; index < args.argv.length; index++) {
    const token = args.argv[index] ?? "";
    if (token === "--") {
      argv.push(...args.argv.slice(index));
      break;
    }
    const spelling = readOptionalValueSpelling({ token, optionalValueSpecs });
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
        lastSpellingAt.set(spelling.flagName, argv.length);
        if (typeof spelling.value === "string") {
          attached.push({
            position: argv.length,
            flagName: spelling.flagName,
            raw: spelling.value,
          });
        }
        argv.push(OPTIONAL_VALUE_PLACEHOLDER);
        break;
    }
  }
  const readings = attached.map((spelling): PositionedReading => {
    const isLast = lastSpellingAt.get(spelling.flagName) === spelling.position;
    return {
      position: spelling.position,
      reading: {
        flagName: spelling.flagName,
        raw: spelling.raw,
        slot: isLast ? { kind: "value" } : { kind: "overridden" },
      },
    };
  });
  return { argv, values, readings, refusals };
}

interface ReadOptionalValueSpellingArgs {
  token: string;
  optionalValueSpecs: ReadonlyMap<string, OptionalValueFlagSpec>;
}

type OptionalValueSpelling =
  | { kind: "other" }
  | { kind: "set"; flagName: string; value: boolean | string }
  | { kind: "refused"; error: FlagLexError };

// One token against the declared optional-value flags: `--x` is true,
// `--no-x` false, `--x=<value>` the raw value, for validation to read.
// `--no-x=<value>` is refused here, since parseArgs would quietly read it
// as `--x=<value>`, and so is any typed reserved key.
function readOptionalValueSpelling(
  args: ReadOptionalValueSpellingArgs,
): OptionalValueSpelling {
  if (!args.token.startsWith("--")) return { kind: "other" };
  const [name = "", ...attachedParts] = args.token.slice(2).split("=");
  // `--x` has no attached value; `--x=` attaches the empty string.
  let attached: string | undefined;
  if (attachedParts.length > 0) attached = attachedParts.join("=");

  const keyAfterNegation = name.startsWith("no-") ? name.slice(3) : name;
  if (
    RESERVED_FLAG_KEYS.has(name) ||
    RESERVED_FLAG_KEYS.has(keyAfterNegation)
  ) {
    return {
      kind: "refused",
      error: { kind: "unknown-flag", flagToken: args.token },
    };
  }

  if (args.optionalValueSpecs.has(name)) {
    return { kind: "set", flagName: name, value: attached ?? true };
  }

  const negatedName = name.startsWith("no-") ? name.slice(3) : undefined;
  if (negatedName === undefined || !args.optionalValueSpecs.has(negatedName)) {
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
