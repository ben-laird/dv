import type { FlagSpec } from "./flag-spec.ts";
import { validateFlagValue } from "./flag-value.ts";
import type { FlagParseError, FlagValueReading } from "./parse-subcommand.ts";

// The validation step: after the sync lexer, each raw value a flag was
// given goes through its spec's value rule, awaited, so a sync and an
// async schema read the same. An absent flag has no value to check.

/** A refused flag value, as the validation step reports it. */
export type InvalidFlagValueError = Extract<
  FlagParseError,
  { kind: "invalid-flag-value" }
>;

/** The outcome of {@link validateFlagValues}. */
export type ValidateFlagValuesOutcome =
  | { ok: true; flags: Record<string, unknown> }
  | { ok: false; error: InvalidFlagValueError };

interface ValidateFlagValuesArgs {
  flagSpecMap: Record<string, FlagSpec>;
  /** The lexed flags, raw. */
  flags: Record<string, unknown>;
  /** The values to check, in argv order. */
  values: readonly FlagValueReading[];
}

/**
 * Checks each raw value in argv order, stopping at the first refusal, and
 * returns the flags with every checked value in place of its raw text.
 */
export async function validateFlagValues(
  args: ValidateFlagValuesArgs,
): Promise<ValidateFlagValuesOutcome> {
  const flags = { ...args.flags };
  for (const reading of args.values) {
    const spec = args.flagSpecMap[reading.flagName];
    // The lexer reads values only for declared value-carrying flags.
    if (spec === undefined || spec.kind === "boolean") continue;
    const validation = await validateFlagValue({ spec, raw: reading.raw });
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          kind: "invalid-flag-value",
          flagName: reading.flagName,
          value: reading.raw,
          ...(reading.slot.kind === "element" && {
            element: reading.slot.index + 1,
          }),
          issues: validation.issues,
          ...(validation.allowedValues !== undefined && {
            allowedValues: validation.allowedValues,
          }),
        },
      };
    }
    placeValue({ flags, reading, value: validation.value });
  }
  return { ok: true, flags };
}

interface PlaceValueArgs {
  flags: Record<string, unknown>;
  reading: FlagValueReading;
  value: unknown;
}

// Writes a checked value where its raw text was; a collect flag's list is
// copied before its first write so the lexer's own array is left alone.
function placeValue(args: PlaceValueArgs): void {
  const { flags, reading } = args;
  switch (reading.slot.kind) {
    case "overridden":
      return;
    case "value":
      flags[reading.flagName] = args.value;
      return;
    case "element": {
      const list = flags[reading.flagName];
      if (!Array.isArray(list)) return;
      const copied = [...list];
      copied[reading.slot.index] = args.value;
      flags[reading.flagName] = copied;
      return;
    }
  }
}
