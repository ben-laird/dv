// Per-flag spec used by every leaf command. Four kinds:
//
//   { kind: "boolean" }         — present-or-absent toggle. The runner
//                                 sees boolean | undefined.
//   { kind: "string" }          — value-carrying scalar; runner sees
//                                 string | undefined.
//   { kind: "collect" }         — repeatable scalar (`--pkg a --pkg b`);
//                                 runner sees string[] | undefined.
//   { kind: "optional-value" }  — a switch that may carry an attached
//                                 value (`--x`, `--no-x`, `--x=null`);
//                                 runner sees boolean | <value> | undefined.
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
 * that may carry an attached value → `boolean | <value> | undefined`). An
 * optional `alias` is the short letter form (`alias: "p"` → `-p`);
 * `description` feeds the auto-generated help renderer. A value-carrying flag
 * may set `valueName` to say what its value is in usage:
 * `{ kind: "string", valueName: "path" }` renders `--out <path>` instead of
 * the default `--out <string>`.
 *
 * An `"optional-value"` flag is written three ways: `--x` (`true`), `--no-x`
 * (`false`), or `--x=<value>`. The value must be attached with `=`: in
 * `--x null` the flag is `true` and `null` stays a positional word. What
 * `<value>` may be is a small vocabulary:
 *
 * - `values` (optional) closes the set: `--x=<value>` must be one of them,
 *   and the runner sees those literals. Without it, any attached string is
 *   accepted and the runner sees `string`.
 * - `booleans: true` also reads `--x=true` / `--x=false` as the booleans,
 *   the way a boolean flag reads `--json=false`.
 *
 * A value outside a declared set is refused as an `invalid-flag-value`
 * error. Usage lists every accepted spelling, `--x[=true|false|null]`, with
 * `<string>` for a free value (`--x[=<string>]`). A `valueName` replaces that
 * list with `--x[=<valueName>]`, which hides a closed set, so leave it unset
 * when the set is short. The flag takes no `alias`: a short letter has no
 * attached-value spelling. `command()` refuses, by throwing when the tree is
 * built, a separate `no-x` flag beside it (`--no-x` already means `false`),
 * an optional-value flag named `no-y` beside a declared `y` (its name would
 * shadow `y`'s negation), and `"true"`/`"false"` in `values` when
 * `booleans: true` (those spellings already read as booleans).
 *
 * @example
 * ```ts
 * const flags = {
 *   askOnCommit: {
 *     kind: "optional-value",
 *     values: ["null"],
 *     booleans: true,
 *     description: "Ask before each commit; =null resets to the default",
 *   },
 * } as const satisfies Record<string, FlagSpec>;
 * // --help:  --askOnCommit[=true|false|null]
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
      /** The closed set an attached value must come from; omit for any string. */
      values?: readonly [string, ...string[]];
      /** Read `--x=true` / `--x=false` as the booleans. */
      booleans?: true;
      alias?: never;
      description?: string;
      valueName?: string;
    };

/**
 * Maps a flag-name → {@link FlagSpec} map to the runner's typed flag object,
 * resolving each flag's `kind` to its runtime value type. An
 * `"optional-value"` flag resolves to `boolean` or its attached value (see
 * {@link AttachedValueOf}). Every property is `| undefined` because an
 * omitted flag may be `undefined` regardless of kind.
 *
 * @typeParam TFlagMap - The command's flag map keyed by flag name.
 */
export type FlagsOf<TFlagMap extends Record<string, FlagSpec>> = {
  [Key in keyof TFlagMap]: TFlagMap[Key]["kind"] extends "boolean"
    ? boolean | undefined
    : TFlagMap[Key]["kind"] extends "string"
      ? string | undefined
      : TFlagMap[Key] extends { kind: "optional-value" }
        ? boolean | AttachedValueOf<TFlagMap[Key]> | undefined
        : string[] | undefined;
};

/**
 * The type of an `"optional-value"` flag's attached value: the union of its
 * declared `values` literals, or `string` when it declares none.
 *
 * @typeParam TSpec - One flag's spec.
 */
export type AttachedValueOf<TSpec> = TSpec extends {
  values: readonly (infer TValue)[];
}
  ? TValue
  : string;

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

/**
 * Why a flag map can't be declared as written. Each case is a bug in the
 * CLI's own declaration, not in what a user typed.
 */
export type FlagSpecError =
  | {
      kind: "negation-collision";
      /** The `"optional-value"` flag that already reads `--no-<name>` as false. */
      flagName: string;
      /** The separately declared `no-<name>` flag it would shadow. */
      negatedFlagName: string;
    }
  | {
      kind: "negated-name-collision";
      /** The `"optional-value"` flag named `no-<base>`. */
      flagName: string;
      /** The declared `<base>` flag whose negation that name spells. */
      baseFlagName: string;
    }
  | {
      kind: "boolean-spelling-in-values";
      /** The `"optional-value"` flag with `booleans: true`. */
      flagName: string;
      /** The declared value `booleans` already reads as a boolean. */
      value: "true" | "false";
    };

/** The outcome of {@link checkFlagSpecMap}. */
export type FlagSpecCheck = { ok: true } | { ok: false; error: FlagSpecError };

/**
 * Checks a flag map for declarations that can't all be honored. An
 * `"optional-value"` flag `x` reads `--no-x` as `false`, so a separately
 * declared `no-x` flag would never be set. Mirrored, an `"optional-value"`
 * flag named `no-y` claims the `--no-y` token, so it can't sit beside a
 * declared `y` of any kind. And with `booleans: true` it reads `=true` /
 * `=false` as booleans, so declaring either in `values` would never yield
 * that string.
 *
 * @param flagSpecMap - The command's flag map keyed by flag name.
 * @returns `{ ok: true }`, or the first {@link FlagSpecError} found.
 */
export function checkFlagSpecMap(
  flagSpecMap: Record<string, FlagSpec>,
): FlagSpecCheck {
  for (const [flagName, flagSpec] of Object.entries(flagSpecMap)) {
    if (flagSpec.kind !== "optional-value") continue;
    const negatedFlagName = `no-${flagName}`;
    if (Object.hasOwn(flagSpecMap, negatedFlagName)) {
      return {
        ok: false,
        error: { kind: "negation-collision", flagName, negatedFlagName },
      };
    }
    const baseFlagName = flagName.slice(3);
    if (
      flagName.startsWith("no-") &&
      Object.hasOwn(flagSpecMap, baseFlagName)
    ) {
      return {
        ok: false,
        error: { kind: "negated-name-collision", flagName, baseFlagName },
      };
    }
    if (flagSpec.booleans !== true) continue;
    for (const value of ["true", "false"] as const) {
      if (flagSpec.values?.includes(value)) {
        return {
          ok: false,
          error: { kind: "boolean-spelling-in-values", flagName, value },
        };
      }
    }
  }
  return { ok: true };
}

/**
 * A one-line explanation of a {@link FlagSpecError}, naming the fix.
 *
 * @param error - The declaration error to describe.
 * @returns The message a CLI author reads.
 */
export function describeFlagSpecError(error: FlagSpecError): string {
  switch (error.kind) {
    case "negation-collision":
      return `flag '${error.negatedFlagName}' collides with optional-value flag '${error.flagName}', which already reads '--${error.negatedFlagName}' as false; drop the separate '${error.negatedFlagName}' flag`;
    case "negated-name-collision":
      return `optional-value flag '${error.flagName}' collides with flag '${error.baseFlagName}': '--${error.flagName}' reads as the negation of '${error.baseFlagName}'; rename the optional-value flag so it doesn't start with 'no-'`;
    case "boolean-spelling-in-values":
      return `optional-value flag '${error.flagName}' declares '${error.value}' in values, but booleans: true already reads '--${error.flagName}=${error.value}' as a boolean; drop '${error.value}' from values`;
  }
}
