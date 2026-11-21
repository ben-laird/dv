import type { FlagSpec } from "./flag-spec.ts";
import type {
  StandardSchemaV1,
  StandardSchemaV1Result,
} from "./standard-schema.ts";

// The value grammar of a value-carrying flag, in one place: what a raw
// value typed on argv means and how usage describes it. Each rule a spec
// can declare lowers to one Standard Schema, so every value is checked
// down the same path: `choices` becomes a built-in literal schema.

/** The spec arm of a flag that carries a value: `string`, `collect` or `optional-value`. */
export type ValueFlagSpec = Exclude<FlagSpec, { kind: "boolean" }>;

/** The spec arm for an `"optional-value"` flag. */
export type OptionalValueFlagSpec = Extract<
  FlagSpec,
  { kind: "optional-value" }
>;

/** One reason a flag value was refused. */
export interface FlagValueIssue {
  /** What was expected, e.g. `expected one of: true|false|null`. */
  message: string;
}

/** The outcome of {@link validateFlagValue}. */
export type FlagValueValidation =
  | { ok: true; value: unknown }
  | {
      ok: false;
      /** Never empty: a refusal always says why. */
      issues: readonly [FlagValueIssue, ...FlagValueIssue[]];
      /** The full accepted set, when the spec declares a closed one. */
      allowedValues?: readonly string[];
    };

interface ValidateFlagValueArgs {
  spec: ValueFlagSpec;
  /** The value as typed: the text after `=` for an optional-value flag. */
  raw: string;
}

/**
 * Reads a raw flag value against its flag's spec. An optional-value flag
 * with `booleans` reads `true` and `false` as booleans first. Then the
 * value goes through the spec's schema (`choices` lowered to a literal
 * one); a spec with neither accepts any string as written.
 */
export async function validateFlagValue(
  args: ValidateFlagValueArgs,
): Promise<FlagValueValidation> {
  const booleanValue = readBooleanSpelling(args);
  if (booleanValue !== undefined) return { ok: true, value: booleanValue };
  const schema = valueSchemaOf(args.spec);
  if (schema === undefined) return { ok: true, value: args.raw };
  const checked = await checkWithSchema({ schema, raw: args.raw });
  if (checked.ok) return checked;
  const allowedValues = allowedValuesOf(args.spec);
  return {
    ok: false,
    issues: checked.issues,
    ...(allowedValues !== undefined && { allowedValues }),
  };
}

/**
 * How an `"optional-value"` flag's value reads in usage, between `[=` and
 * `]`: its `valueName` as `<name>`, or else every accepted spelling, `|`-
 * joined (`true|false|null`), with `<string>` standing for a free value.
 */
export function describeOptionalValue(spec: OptionalValueFlagSpec): string {
  if (spec.valueName !== undefined) return `<${spec.valueName}>`;
  const spellings = [...booleanSpellings(spec), ...(spec.choices ?? [])];
  if (spec.choices === undefined) spellings.push("<string>");
  return spellings.join("|");
}

// The one schema a spec's value goes through, if it declares a rule.
function valueSchemaOf(spec: ValueFlagSpec): StandardSchemaV1 | undefined {
  if (spec.schema !== undefined) return spec.schema;
  if (spec.kind !== "optional-value" || spec.choices === undefined) {
    return undefined;
  }
  return choicesSchema({
    choices: spec.choices,
    allowedValues: [...booleanSpellings(spec), ...spec.choices],
  });
}

// The full accepted set a refusal reports: only a closed set has one.
function allowedValuesOf(spec: ValueFlagSpec): readonly string[] | undefined {
  if (spec.kind !== "optional-value" || spec.choices === undefined) {
    return undefined;
  }
  return [...booleanSpellings(spec), ...spec.choices];
}

interface ChoicesSchemaArgs {
  choices: readonly string[];
  /** Every accepted spelling, booleans included, for the refusal message. */
  allowedValues: readonly string[];
}

// `choices` as a Standard Schema: the raw value must be one of them.
function choicesSchema(
  args: ChoicesSchemaArgs,
): StandardSchemaV1<string, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "clipc",
      validate: (value) => {
        if (typeof value === "string" && args.choices.includes(value)) {
          return { value };
        }
        return {
          issues: [
            { message: `expected one of: ${args.allowedValues.join("|")}` },
          ],
        };
      },
    },
  };
}

interface CheckWithSchemaArgs {
  schema: StandardSchemaV1;
  raw: string;
}

type SchemaCheck =
  | { ok: true; value: unknown }
  | { ok: false; issues: readonly [FlagValueIssue, ...FlagValueIssue[]] };

// Awaits the schema, so a sync and an async one read the same, and keeps
// only each issue's message: a flag value is a scalar, so paths are noise.
async function checkWithSchema(
  args: CheckWithSchemaArgs,
): Promise<SchemaCheck> {
  const outcome = await runSchema(args);
  if (!outcome.ok) {
    return {
      ok: false,
      issues: [{ message: `the flag's schema threw: ${outcome.reason}` }],
    };
  }
  const result = outcome.result;
  if (result.issues === undefined) return { ok: true, value: result.value };
  const [firstIssue, ...otherIssues] = result.issues.map((issue) => {
    return { message: issue.message };
  });
  if (firstIssue === undefined) {
    return { ok: false, issues: [{ message: SCHEMA_REFUSED_MESSAGE }] };
  }
  return { ok: false, issues: [firstIssue, ...otherIssues] };
}

// What a refusal says when its schema failed without naming an issue.
const SCHEMA_REFUSED_MESSAGE = "the value was refused";

type SchemaRun =
  | { ok: true; result: StandardSchemaV1Result<unknown> }
  | { ok: false; reason: string };

// The edge around third-party code: a schema that throws (or rejects) is
// turned into a value here, so the throw never reaches the leaf's handler.
async function runSchema(args: CheckWithSchemaArgs): Promise<SchemaRun> {
  try {
    return {
      ok: true,
      result: await args.schema["~standard"].validate(args.raw),
    };
  } catch (thrown: unknown) {
    return {
      ok: false,
      reason: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }
}

function readBooleanSpelling(args: ValidateFlagValueArgs): boolean | undefined {
  if (args.spec.kind !== "optional-value") return undefined;
  if (args.spec.booleans !== true) return undefined;
  if (args.raw === "true") return true;
  if (args.raw === "false") return false;
  return undefined;
}

function booleanSpellings(spec: OptionalValueFlagSpec): string[] {
  return spec.booleans === true ? ["true", "false"] : [];
}
