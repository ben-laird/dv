// Per-flag spec used by every leaf command. Three kinds:
//
//   { kind: "boolean" }  — present-or-absent toggle. The runner
//                          sees boolean | undefined.
//   { kind: "string" }   — value-carrying scalar; runner sees
//                          string | undefined.
//   { kind: "collect" }  — repeatable scalar (`--pkg a --pkg b`);
//                          runner sees string[] | undefined.
//
// Aliases are short letter forms (`alias: "p"` → `-p`). `description`
// feeds the auto-generated help renderer.

/**
 * The spec for a single flag on a leaf command. The `kind` selects the runtime
 * type the runner sees: `"boolean"` (present-or-absent toggle →
 * `boolean | undefined`), `"string"` (value-carrying scalar →
 * `string | undefined`), or `"collect"` (repeatable scalar like
 * `--pkg a --pkg b` → `string[] | undefined`). An optional `alias` is the short
 * letter form (`alias: "p"` → `-p`); `description` feeds the auto-generated
 * help renderer.
 */
export type FlagSpec =
  | { kind: "boolean"; alias?: string; description?: string }
  | { kind: "string"; alias?: string; description?: string }
  | { kind: "collect"; alias?: string; description?: string };

/**
 * Maps a flag-name → {@link FlagSpec} map to the runner's typed flag object,
 * resolving each flag's `kind` to its runtime value type. Every property is
 * `| undefined` because `parseArgs` returns `undefined` for omitted flags
 * regardless of kind.
 *
 * @typeParam TFlagMap - The command's flag map keyed by flag name.
 */
export type FlagsOf<TFlagMap extends Record<string, FlagSpec>> = {
  [Key in keyof TFlagMap]: TFlagMap[Key]["kind"] extends "boolean"
    ? boolean | undefined
    : TFlagMap[Key]["kind"] extends "string"
      ? string | undefined
      : string[] | undefined;
};

/**
 * The lowered, `parseArgs`-shaped form of a flag map: parallel name arrays by
 * kind (`string` / `boolean` / `collect`) plus a flat short-letter `alias` map.
 * Produced by {@link lowerFlagSpec}.
 */
export interface LoweredFlagSpec {
  /** Names of value-carrying flags (includes `collect` flags). */
  string: string[];
  /** Names of present-or-absent boolean flags. */
  boolean: string[];
  /** Names of repeatable flags collected into arrays. */
  collect: string[];
  /** Short-letter alias → flag-name map. */
  alias: Record<string, string>;
}

/**
 * Lowers a flag-name → {@link FlagSpec} map to the {@link LoweredFlagSpec} shape
 * `parseArgs` wants. Each flag's name is sorted into the array for its kind
 * (`collect` flags go into both `string` and `collect`, since `collect` alone
 * makes `parseArgs` treat the flag as boolean), and any `alias` is recorded in
 * the flat `alias` map.
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
 * // → { string: ["pkg"], boolean: ["json"], collect: ["pkg"], alias: { p: "pkg" } }
 * ```
 */
export function lowerFlagSpec(
  flagSpecMap: Record<string, FlagSpec>,
): LoweredFlagSpec {
  const lowered: LoweredFlagSpec = {
    string: [],
    boolean: [],
    collect: [],
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
    }
    if (flagSpec.alias !== undefined) {
      lowered.alias[flagSpec.alias] = flagName;
    }
  }
  return lowered;
}
