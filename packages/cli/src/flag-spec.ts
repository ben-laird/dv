import type { FlagSpec } from "./command-spec.ts";

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
