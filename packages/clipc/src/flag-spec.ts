// Per-flag spec used by every leaf command. Four kinds:
//
//   { kind: "boolean" }         — present-or-absent toggle. The runner
//                                 sees boolean | undefined.
//   { kind: "string" }          — value-carrying scalar; runner sees
//                                 string | undefined.
//   { kind: "collect" }         — repeatable scalar (`--pkg a --pkg b`);
//                                 runner sees string[] | undefined.
//   { kind: "optional-value" }  — a switch that may carry one declared
//                                 value, attached (`--x`, `--no-x`,
//                                 `--x=null`); runner sees
//                                 boolean | <declared value> | undefined.
//
// Aliases are short letter forms (`alias: "p"` → `-p`). `description`
// feeds the auto-generated help renderer, and a value-carrying flag's
// `valueName` names its value there (`--pkg <name>`).

/**
 * The spec for a single flag on a leaf command. The `kind` selects the runtime
 * type the runner sees: `"boolean"` (present-or-absent toggle →
 * `boolean | undefined`), `"string"` (value-carrying scalar →
 * `string | undefined`), `"collect"` (repeatable scalar like
 * `--pkg a --pkg b` → `string[] | undefined`), or `"optional-value"` (a switch
 * that may carry one of its declared `values` →
 * `boolean | <one of values> | undefined`). An optional `alias` is the short
 * letter form (`alias: "p"` → `-p`); `description` feeds the auto-generated
 * help renderer. A value-carrying flag may set `valueName` to say what its
 * value is in usage: `{ kind: "string", valueName: "path" }` renders
 * `--out <path>` instead of the default `--out <string>`.
 *
 * An `"optional-value"` flag is written three ways: `--x` (`true`), `--no-x`
 * (`false`), or `--x=<value>` with a value from `values`. The value must be
 * attached with `=`: in `--x null` the flag is `true` and `null` stays a
 * positional word. A value outside `values` is refused as an
 * `invalid-flag-value` error. Usage renders `--x[=null]` (the declared values,
 * `|`-separated), or `--x[=<valueName>]` when `valueName` is set. It takes no
 * `alias`: a short letter has no attached-value spelling.
 *
 * @example
 * ```ts
 * const flags = {
 *   askOnCommit: {
 *     kind: "optional-value",
 *     values: ["null"],
 *     description: "Ask before each commit; =null resets to the default",
 *   },
 * } satisfies Record<string, FlagSpec>;
 * // --help:  --askOnCommit[=null]
 * // runner:  flags.askOnCommit is boolean | "null" | undefined
 * ```
 */
export type FlagSpec =
  | { kind: "boolean"; alias?: string; description?: string }
  | {
      kind: "string";
      alias?: string;
      description?: string;
      valueName?: string;
    }
  | {
      kind: "collect";
      alias?: string;
      description?: string;
      valueName?: string;
    }
  | {
      kind: "optional-value";
      values: readonly [string, ...string[]];
      alias?: never;
      description?: string;
      valueName?: string;
    };

/**
 * Maps a flag-name → {@link FlagSpec} map to the runner's typed flag object,
 * resolving each flag's `kind` to its runtime value type. An
 * `"optional-value"` flag resolves to `boolean` or one of its declared
 * `values` literals. Every property is `| undefined` because an omitted flag
 * may be `undefined` regardless of kind.
 *
 * @typeParam TFlagMap - The command's flag map keyed by flag name.
 */
export type FlagsOf<TFlagMap extends Record<string, FlagSpec>> = {
  [Key in keyof TFlagMap]: TFlagMap[Key]["kind"] extends "boolean"
    ? boolean | undefined
    : TFlagMap[Key]["kind"] extends "string"
      ? string | undefined
      : TFlagMap[Key] extends {
            kind: "optional-value";
            values: readonly (infer TValue)[];
          }
        ? boolean | TValue | undefined
        : string[] | undefined;
};

/**
 * The lowered, `parseArgs`-shaped form of a flag map: parallel name arrays by
 * kind (`string` / `boolean` / `collect`) plus a flat short-letter `alias` map.
 * `optionalValue` lists the flags `parseArgs` cannot express on its own.
 * Produced by {@link lowerFlagSpec}.
 */
export interface LoweredFlagSpec {
  /** Names of value-carrying flags (includes `collect` flags). */
  string: string[];
  /** Names of present-or-absent boolean flags. */
  boolean: string[];
  /** Names of repeatable flags collected into arrays. */
  collect: string[];
  /**
   * Names of `"optional-value"` flags. `parseArgs` has no optional attached
   * value, so these are in no other array; a leaf reads their spellings
   * itself before handing the rest of argv to `parseArgs`.
   */
  optionalValue: string[];
  /** Short-letter alias → flag-name map. */
  alias: Record<string, string>;
}

/**
 * Lowers a flag-name → {@link FlagSpec} map to the {@link LoweredFlagSpec} shape
 * `parseArgs` wants. Each flag's name is sorted into the array for its kind
 * (`collect` flags go into both `string` and `collect`, since `collect` alone
 * makes `parseArgs` treat the flag as boolean), `"optional-value"` flags go
 * into `optionalValue` only, and any `alias` is recorded in the flat `alias`
 * map.
 *
 * @param flagSpecMap - The command's flag map keyed by flag name.
 * @returns The lowered spec ready to pass to `parseArgs`.
 *
 * @example
 * ```ts
 * lowerFlagSpec({
 *   json: { kind: "boolean" },
 *   pkg: { kind: "collect", alias: "p" },
 * });
 * // → { string: ["pkg"], boolean: ["json"], collect: ["pkg"],
 * //     optionalValue: [], alias: { p: "pkg" } }
 * ```
 */
export function lowerFlagSpec(
  flagSpecMap: Record<string, FlagSpec>,
): LoweredFlagSpec {
  const lowered: LoweredFlagSpec = {
    string: [],
    boolean: [],
    collect: [],
    optionalValue: [],
    alias: {},
  };
  for (const [flagName, flagSpec] of Object.entries(flagSpecMap)) {
    switch (flagSpec.kind) {
      case "string":
        lowered.string.push(flagName);
        break;
      case "boolean":
        lowered.boolean.push(flagName);
        break;
      case "collect":
        // parseArgs models repeatable flags as `collect: [name]` plus
        // `string: [name]` — collect alone treats the flag as boolean.
        lowered.string.push(flagName);
        lowered.collect.push(flagName);
        break;
      case "optional-value":
        lowered.optionalValue.push(flagName);
        break;
    }
    if (flagSpec.alias !== undefined) {
      lowered.alias[flagSpec.alias] = flagName;
    }
  }
  return lowered;
}
