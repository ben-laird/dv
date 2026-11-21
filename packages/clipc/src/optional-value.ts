import type { FlagSpec } from "./flag-spec.ts";

// The value grammar of an `"optional-value"` flag, in one place: what an
// attached `--x=<raw>` means and how usage describes it. Both read only the
// spec, so a later spec form (a Standard Schema, #51) adds a case here.

/** The spec arm for an `"optional-value"` flag. */
export type OptionalValueFlagSpec = Extract<
  FlagSpec,
  { kind: "optional-value" }
>;

/** One reason an attached value was refused. */
export interface FlagValueIssue {
  /** What was expected, e.g. `expected one of: true|false|null`. */
  message: string;
}

/** The outcome of {@link validateOptionalValue}. */
export type OptionalValueValidation =
  | { ok: true; value: boolean | string }
  | {
      ok: false;
      /** Never empty: a refusal always says why. */
      issues: readonly [FlagValueIssue, ...FlagValueIssue[]];
      /** The full accepted set, when the spec declares a closed one. */
      allowedValues?: readonly string[];
    };

interface ValidateOptionalValueArgs {
  spec: OptionalValueFlagSpec;
  /** The text after `=` in `--x=<raw>`. */
  raw: string;
}

/**
 * Reads an attached `--x=<raw>` against its flag's spec. With `booleans`,
 * `true` and `false` become booleans. Then a declared `values` set must
 * contain `raw`; without one, any string is accepted as written.
 */
export function validateOptionalValue(
  args: ValidateOptionalValueArgs,
): OptionalValueValidation {
  const booleanValue = readBooleanSpelling(args);
  if (booleanValue !== undefined) return { ok: true, value: booleanValue };
  const declaredValues = args.spec.values;
  if (declaredValues === undefined || declaredValues.includes(args.raw)) {
    return { ok: true, value: args.raw };
  }
  const allowedValues = [...booleanSpellings(args.spec), ...declaredValues];
  return {
    ok: false,
    issues: [{ message: `expected one of: ${allowedValues.join("|")}` }],
    allowedValues,
  };
}

/**
 * How an `"optional-value"` flag's value reads in usage, between `[=` and
 * `]`: its `valueName` as `<name>`, or else every accepted spelling, `|`-
 * joined (`true|false|null`), with `<string>` standing for a free value.
 */
export function describeOptionalValue(spec: OptionalValueFlagSpec): string {
  if (spec.valueName !== undefined) return `<${spec.valueName}>`;
  const spellings = [...booleanSpellings(spec), ...(spec.values ?? [])];
  if (spec.values === undefined) spellings.push("<string>");
  return spellings.join("|");
}

function readBooleanSpelling(
  args: ValidateOptionalValueArgs,
): boolean | undefined {
  if (args.spec.booleans !== true) return undefined;
  if (args.raw === "true") return true;
  if (args.raw === "false") return false;
  return undefined;
}

function booleanSpellings(spec: OptionalValueFlagSpec): string[] {
  return spec.booleans === true ? ["true", "false"] : [];
}
