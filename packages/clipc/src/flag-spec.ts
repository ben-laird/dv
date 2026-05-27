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

export type FlagSpec =
  | { kind: "boolean"; alias?: string; description?: string }
  | { kind: "string"; alias?: string; description?: string }
  | { kind: "collect"; alias?: string; description?: string };

// Maps a per-flag spec to the runner's typed flag object. The
// runtime values come from `parseArgs`, which returns `undefined`
// for flags the user omitted regardless of kind.
export type FlagsOf<TFlagMap extends Record<string, FlagSpec>> = {
  [Key in keyof TFlagMap]: TFlagMap[Key]["kind"] extends "boolean"
    ? boolean | undefined
    : TFlagMap[Key]["kind"] extends "string"
      ? string | undefined
      : string[] | undefined;
};

// Lowers a per-flag FlagSpec map to the string-array shape parseArgs
// wants. Each flag's kind contributes to exactly one of the four
// arrays (string / boolean / collect / negatable); aliases go into the
// flat `alias` map.

export interface LoweredFlagSpec {
  string: string[];
  boolean: string[];
  collect: string[];
  alias: Record<string, string>;
}

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
