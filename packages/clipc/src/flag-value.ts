import type { FlagSpec } from "./flag-spec.ts";
import type {
  StandardJSONSchemaV1Converter,
  StandardSchemaV1,
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
 * `undefined` when the schema offers no Standard JSON Schema converter,
 * reading or calling it throws, it returns anything but a plain object
 * (`null`, a string, a promise), or the JSON Schema lists no such choices.
 */
export function schemaChoices(
  schema: StandardSchemaV1,
): readonly string[] | undefined {
  // The edge around third-party code: a getter on the schema or its JSON
  // Schema may throw, and the spec lets the converter throw, so every read
  // happens inside this one guard. A throw just means no choices to list.
  try {
    const props: object = schema["~standard"];
    const converter = fieldOf({ source: props, key: "jsonSchema" });
    if (!isJsonSchemaConverter(converter)) return undefined;
    const jsonSchema: unknown = converter.input({ target: "draft-2020-12" });
    if (!isPlainObject(jsonSchema)) {
      settleIfThenable(jsonSchema);
      return undefined;
    }
    return choicesInJsonSchema(jsonSchema);
  } catch {
    return undefined;
  }
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

// A JSON Schema is a plain object; `null`, arrays, functions and promises
// (a converter that wrongly went async) are not.
function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  return !Array.isArray(value) && !isThenable(value);
}

function isThenable(value: object): boolean {
  return "then" in value && typeof value.then === "function";
}

// A promise nobody awaits must not reject unhandled, so it is settled here.
function settleIfThenable(value: unknown): void {
  if (typeof value !== "object" || value === null || !isThenable(value)) {
    return;
  }
  Promise.resolve(value).catch(() => undefined);
}

function choicesInJsonSchema(
  jsonSchema: object,
): readonly string[] | undefined {
  const constant = fieldOf({ source: jsonSchema, key: "const" });
  if (typeof constant === "string") return allStrings([constant]);
  const enumerated = fieldOf({ source: jsonSchema, key: "enum" });
  if (Array.isArray(enumerated)) return allStrings(enumerated);
  const anyOf = fieldOf({ source: jsonSchema, key: "anyOf" });
  const members = anyOf ?? fieldOf({ source: jsonSchema, key: "oneOf" });
  if (!Array.isArray(members)) return undefined;
  return allStrings(members.map(constOf));
}

// A JSON Schema member's `const`, if it has one.
function constOf(member: unknown): unknown {
  if (typeof member !== "object" || member === null) return undefined;
  return fieldOf({ source: member, key: "const" });
}

interface FieldOfArgs {
  source: object;
  key: string;
}

// One property of an object of unknown shape, or `undefined`.
function fieldOf(args: FieldOfArgs): unknown {
  if (!(args.key in args.source)) return undefined;
  const value: unknown = Reflect.get(args.source, args.key);
  return value;
}

// The values as listable choices when every one is a string, else none of
// them. An empty string would print as nothing (`<>`), so it is skipped.
function allStrings(values: readonly unknown[]): readonly string[] | undefined {
  const strings = values.filter((value) => typeof value === "string");
  if (strings.length !== values.length) return undefined;
  const listable = strings.filter((value) => value !== "");
  return listable.length === 0 ? undefined : listable;
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
// The edge around third-party code: a schema that throws or rejects, or
// returns something the spec doesn't allow, becomes a value here. The
// result is read inside the same guard, since its getters may throw too.
async function checkWithSchema(
  args: CheckWithSchemaArgs,
): Promise<FlagValueValidation> {
  try {
    const result: unknown = await args.schema["~standard"].validate(args.raw);
    return readSchemaResult(result);
  } catch (thrown: unknown) {
    return schemaFailed(describeThrown(thrown));
  }
}

// What a refusal says when its schema failed without naming an issue.
const SCHEMA_REFUSED_MESSAGE = "the value was refused";
// What a failure says when the thrown value has no text to show.
const UNSHOWABLE_THROW_MESSAGE = "the schema threw a value that can't be shown";

// A schema's result, read as the spec defines it, never trusted: an object
// whose `issues` is absent (success, with `value`) or a list of issues each
// carrying a text `message`. Anything else is the schema's failure.
function readSchemaResult(result: unknown): FlagValueValidation {
  if (typeof result !== "object" || result === null) {
    return schemaFailed(`the schema returned ${String(result)}, not a result`);
  }
  const issues = fieldOf({ source: result, key: "issues" });
  if (issues === undefined) {
    return { ok: true, value: fieldOf({ source: result, key: "value" }) };
  }
  if (!Array.isArray(issues)) {
    return schemaFailed("the schema returned issues that aren't a list");
  }
  const messages = issues.map(issueMessageOf);
  if (!messages.every((message) => typeof message === "string")) {
    return schemaFailed("the schema returned an issue with no text message");
  }
  const [firstMessage, ...otherMessages] = messages;
  if (firstMessage === undefined) {
    return refused([{ message: SCHEMA_REFUSED_MESSAGE }]);
  }
  return refused([
    { message: firstMessage },
    ...otherMessages.map((message) => ({ message })),
  ]);
}

// An issue's `message`, if the issue is an object that has one.
function issueMessageOf(issue: unknown): unknown {
  if (typeof issue !== "object" || issue === null) return undefined;
  return fieldOf({ source: issue, key: "message" });
}

function refused(
  issues: readonly [FlagValueIssue, ...FlagValueIssue[]],
): FlagValueValidation {
  return { ok: false, error: { kind: "refused", issues } };
}

function schemaFailed(message: string): FlagValueValidation {
  return { ok: false, error: { kind: "schema-failed", message } };
}

// A thrown value as text, which may itself throw (`Object.create(null)`,
// a throwing `message` getter), so it has its own guard. A message that
// isn't a non-empty string reads as the fixed fallback.
function describeThrown(thrown: unknown): string {
  try {
    let text: unknown;
    if (thrown instanceof Error) {
      text = thrown.message;
    } else {
      text = String(thrown);
    }
    if (typeof text === "string" && text !== "") return text;
    return UNSHOWABLE_THROW_MESSAGE;
  } catch {
    return UNSHOWABLE_THROW_MESSAGE;
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
