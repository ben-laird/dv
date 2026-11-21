import type { FlagSpec } from "./flag-spec.ts";
import type {
  StandardJSONSchemaV1Converter,
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

/**
 * Why a flag value was not accepted: the value was `refused` by its rule,
 * or the flag's schema itself failed (threw or rejected), which is no fault
 * of what was typed.
 */
export type FlagValueError =
  | {
      kind: "refused";
      /** Never empty: a refusal always says why. */
      issues: readonly [FlagValueIssue, ...FlagValueIssue[]];
      /** The full accepted set, when the spec declares a closed one. */
      allowedValues?: readonly string[];
    }
  | {
      kind: "schema-failed";
      /** What the schema threw, as text. */
      message: string;
    };

/** The outcome of {@link validateFlagValue}. */
export type FlagValueValidation =
  | { ok: true; value: unknown }
  | { ok: false; error: FlagValueError };

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
  if (checked.ok || checked.error.kind === "schema-failed") return checked;
  const allowedValues = allowedValuesOf(args.spec);
  return {
    ok: false,
    error: {
      kind: "refused",
      issues: checked.error.issues,
      ...(allowedValues !== undefined && { allowedValues }),
    },
  };
}

/**
 * How a value-carrying flag's value reads in usage: after `--out ` for a
 * `string` or `collect` flag, between `[=` and `]` for an
 * `"optional-value"` one. In priority order: its `valueName` as `<name>`;
 * its `choices`; the string choices its `schema`'s JSON Schema lists; or a
 * placeholder, `<value>` for a schema and `<kind>` (`<string>`) without
 * one. Choices are `|`-joined: inside `<…>` for a `string` or `collect`
 * flag (`<always|never>`), and after any boolean spellings for an
 * optional-value one (`true|false|null`), where a placeholder follows them
 * too.
 */
export function describeFlagValue(spec: ValueFlagSpec): string {
  if (spec.valueName !== undefined) return `<${spec.valueName}>`;
  const choices = declaredChoicesOf(spec) ?? schemaChoicesOf(spec.schema);
  const placeholder = spec.schema === undefined ? "<string>" : "<value>";
  if (spec.kind === "optional-value") {
    const spellings = booleanSpellings(spec);
    return [...spellings, ...(choices ?? [placeholder])].join("|");
  }
  // A required value keeps its angle brackets: `--color <always|never>`.
  if (choices !== undefined) return `<${choices.join("|")}>`;
  return spec.schema === undefined ? `<${spec.kind}>` : placeholder;
}

/**
 * The string choices a schema's input JSON Schema lists, for usage: an
 * `enum`, a `const`, or an `anyOf` / `oneOf` of `const`s, each all strings.
 * `undefined` when the schema offers no Standard JSON Schema converter, the
 * converter throws, or the JSON Schema lists no such choices.
 */
export function schemaChoices(
  schema: StandardSchemaV1,
): readonly string[] | undefined {
  const converter = jsonSchemaConverterOf(schema);
  if (converter === undefined) return undefined;
  const jsonSchema = convertInput(converter);
  if (jsonSchema === undefined) return undefined;
  return choicesInJsonSchema(jsonSchema);
}

// Only an optional-value flag declares `choices`.
function declaredChoicesOf(spec: ValueFlagSpec): readonly string[] | undefined {
  return spec.kind === "optional-value" ? spec.choices : undefined;
}

function schemaChoicesOf(
  schema: StandardSchemaV1 | undefined,
): readonly string[] | undefined {
  return schema === undefined ? undefined : schemaChoices(schema);
}

// The Standard JSON Schema converter is a capability a schema may lack, so
// it is read through a guard, never assumed.
function jsonSchemaConverterOf(
  schema: StandardSchemaV1,
): StandardJSONSchemaV1Converter | undefined {
  const props: object = schema["~standard"];
  if (!("jsonSchema" in props)) return undefined;
  return isJsonSchemaConverter(props.jsonSchema) ? props.jsonSchema : undefined;
}

function isJsonSchemaConverter(
  value: unknown,
): value is StandardJSONSchemaV1Converter {
  return (
    typeof value === "object" &&
    value !== null &&
    "input" in value &&
    typeof value.input === "function"
  );
}

// The edge around third-party code: the spec lets a converter throw for a
// type it can't express, which here just means "no choices to list".
function convertInput(
  converter: StandardJSONSchemaV1Converter,
): Record<string, unknown> | undefined {
  try {
    return converter.input({ target: "draft-2020-12" });
  } catch {
    return undefined;
  }
}

function choicesInJsonSchema(
  jsonSchema: Record<string, unknown>,
): readonly string[] | undefined {
  if (typeof jsonSchema.const === "string") return [jsonSchema.const];
  if (Array.isArray(jsonSchema.enum)) return allStrings(jsonSchema.enum);
  const members = jsonSchema.anyOf ?? jsonSchema.oneOf;
  if (!Array.isArray(members)) return undefined;
  return allStrings(members.map(constOf));
}

// A JSON Schema member's `const`, if it has one.
function constOf(member: unknown): unknown {
  if (typeof member !== "object" || member === null) return undefined;
  if (!("const" in member)) return undefined;
  return member.const;
}

// The values as strings when every one is a string, else none of them.
function allStrings(values: readonly unknown[]): readonly string[] | undefined {
  if (values.length === 0) return undefined;
  const strings = values.filter((value) => typeof value === "string");
  return strings.length === values.length ? strings : undefined;
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

// Awaits the schema, so a sync and an async one read the same, and keeps
// only each issue's message: a flag value is a scalar, so paths are noise.
async function checkWithSchema(
  args: CheckWithSchemaArgs,
): Promise<FlagValueValidation> {
  const outcome = await runSchema(args);
  if (!outcome.ok) {
    return {
      ok: false,
      error: { kind: "schema-failed", message: outcome.reason },
    };
  }
  const result = outcome.result;
  if (result.issues === undefined) return { ok: true, value: result.value };
  const [firstIssue, ...otherIssues] = result.issues.map((issue) => {
    return { message: issue.message };
  });
  if (firstIssue === undefined) {
    return {
      ok: false,
      error: { kind: "refused", issues: [{ message: SCHEMA_REFUSED_MESSAGE }] },
    };
  }
  return {
    ok: false,
    error: { kind: "refused", issues: [firstIssue, ...otherIssues] },
  };
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

// Only an optional-value flag reads `=true` / `=false` as booleans.
function booleanSpellings(spec: ValueFlagSpec): string[] {
  if (spec.kind !== "optional-value") return [];
  return spec.booleans === true ? ["true", "false"] : [];
}
