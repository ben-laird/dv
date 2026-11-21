import { assertEquals } from "@std/assert";
import { z } from "zod";
import {
  describeFlagValue,
  type OptionalValueFlagSpec,
  schemaChoices,
  validateFlagValue,
} from "./flag-value.ts";
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
  StandardSchemaV1Result,
} from "./standard-schema.ts";

// A hand-written Standard Schema whose `validate` is the given function.
function fakeSchema<TOutput>(
  validate: (
    value: unknown,
  ) =>
    | StandardSchemaV1Result<TOutput>
    | Promise<StandardSchemaV1Result<TOutput>>,
): StandardSchemaV1<string, TOutput> {
  return { "~standard": { version: 1, vendor: "fake", validate } };
}

// Reads digits as a number, synchronously.
const digits = fakeSchema((value) => {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return { value: Number(value) };
  }
  return { issues: [{ message: "expected digits", path: ["ignored"] }] };
});

const closedSet: OptionalValueFlagSpec = {
  kind: "optional-value",
  choices: ["null"],
};
const closedSetWithBooleans: OptionalValueFlagSpec = {
  kind: "optional-value",
  choices: ["null"],
  booleans: true,
};
const freeString: OptionalValueFlagSpec = { kind: "optional-value" };

Deno.test("validateFlagValue accepts a declared value as written", async () => {
  // Given a closed set of one value
  // When that value is attached
  const validation = await validateFlagValue({ spec: closedSet, raw: "null" });

  // Then it is accepted unchanged
  assertEquals(validation, { ok: true, value: "null" });
});

Deno.test("validateFlagValue refuses an undeclared value with one issue and the set", async () => {
  // Given a closed set without booleans
  // When `true` is attached
  const validation = await validateFlagValue({ spec: closedSet, raw: "true" });

  // Then it is refused: without booleans, `true` is just an undeclared word
  assertEquals(validation, {
    ok: false,
    error: {
      kind: "refused",
      issues: [{ message: "expected one of: null" }],
      allowedValues: ["null"],
    },
  });
});

Deno.test("validateFlagValue reads true and false as booleans when booleans is on", async () => {
  // Given a closed set with booleans
  // When each boolean word is attached
  const trueValue = await validateFlagValue({
    spec: closedSetWithBooleans,
    raw: "true",
  });
  const falseValue = await validateFlagValue({
    spec: closedSetWithBooleans,
    raw: "false",
  });

  // Then they become the booleans, not the strings
  assertEquals(trueValue, { ok: true, value: true });
  assertEquals(falseValue, { ok: true, value: false });
});

Deno.test("validateFlagValue accepts any text when no choices are declared", async () => {
  // Given a free-string spec
  for (const raw of ["", "true", "a=b", "anything"]) {
    // When the text is attached
    const validation = await validateFlagValue({ spec: freeString, raw });

    // Then it is accepted as written, never refused
    assertEquals(validation, { ok: true, value: raw });
  }
});

Deno.test("describeFlagValue names every accepted spelling", () => {
  // Given each shape of the vocabulary
  // When described for usage
  // Then booleans come first, then the set, with <string> for free text
  assertEquals(describeFlagValue(closedSet), "null");
  assertEquals(describeFlagValue(closedSetWithBooleans), "true|false|null");
  assertEquals(describeFlagValue(freeString), "<string>");
  assertEquals(
    describeFlagValue({ kind: "optional-value", booleans: true }),
    "true|false|<string>",
  );
});

Deno.test("describeFlagValue lets valueName replace the listing", () => {
  // Given a closed set that also names its value
  const spec: OptionalValueFlagSpec = {
    kind: "optional-value",
    choices: ["null"],
    booleans: true,
    valueName: "setting",
  };

  // When described for usage
  // Then the name stands in for the set
  assertEquals(describeFlagValue(spec), "<setting>");
});

Deno.test("validateFlagValue hands back a sync schema's output", async () => {
  // Given a string flag whose schema reads digits as a number
  const spec = { kind: "string", schema: digits } as const;

  // When digits are typed
  const validation = await validateFlagValue({ spec, raw: "42" });

  // Then the value is the schema's output, not the text
  assertEquals(validation, { ok: true, value: 42 });
});

Deno.test("validateFlagValue awaits an async schema", async () => {
  // Given a collect flag whose schema resolves later
  const later = fakeSchema(async (value) => {
    await Promise.resolve();
    return { value: `checked:${String(value)}` };
  });

  // When a value is typed
  const validation = await validateFlagValue({
    spec: { kind: "collect", schema: later },
    raw: "a",
  });

  // Then its resolved output is the value
  assertEquals(validation, { ok: true, value: "checked:a" });
});

Deno.test("validateFlagValue keeps only each issue's message", async () => {
  // Given a schema that refuses with a path on its issue
  const spec = { kind: "string", schema: digits } as const;

  // When it refuses a value
  const validation = await validateFlagValue({ spec, raw: "x" });

  // Then the refusal carries the message alone, and no closed set
  assertEquals(validation, {
    ok: false,
    error: {
      kind: "refused",
      issues: [{ message: "expected digits" }],
    },
  });
});

Deno.test("validateFlagValue gives a schema that fails without issues a fixed reason", async () => {
  // Given a schema that fails with an empty issue list
  const silent = fakeSchema(() => ({ issues: [] }));

  // When it refuses a value
  const validation = await validateFlagValue({
    spec: { kind: "string", schema: silent },
    raw: "x",
  });

  // Then the refusal still says why, so it is never empty
  assertEquals(validation, {
    ok: false,
    error: {
      kind: "refused",
      issues: [{ message: "the value was refused" }],
    },
  });
});

Deno.test("validateFlagValue reports a schema that throws or rejects as failed, not refused", async () => {
  // Given a schema that throws an Error, one whose promise rejects with an
  // Error, and one that throws a value that isn't an Error
  const throwing = fakeSchema(() => {
    throw new Error("boom");
  });
  const rejecting = fakeSchema(() => {
    return Promise.reject(new Error("no network"));
  });
  const throwingText = fakeSchema(() => {
    throw "bad config";
  });

  // When each checks a value
  const thrown = await validateFlagValue({
    spec: { kind: "string", schema: throwing },
    raw: "x",
  });
  const rejected = await validateFlagValue({
    spec: { kind: "optional-value", schema: rejecting },
    raw: "x",
  });
  const thrownText = await validateFlagValue({
    spec: { kind: "collect", schema: throwingText },
    raw: "x",
  });

  // Then none escapes: each is a schema failure carrying what was thrown
  assertEquals(thrown, {
    ok: false,
    error: { kind: "schema-failed", message: "boom" },
  });
  assertEquals(rejected, {
    ok: false,
    error: { kind: "schema-failed", message: "no network" },
  });
  assertEquals(thrownText, {
    ok: false,
    error: { kind: "schema-failed", message: "bad config" },
  });
});

Deno.test("validateFlagValue reads booleans before an optional-value flag's schema", async () => {
  // Given an optional-value flag with booleans and a digits schema
  const spec: OptionalValueFlagSpec = {
    kind: "optional-value",
    schema: digits,
    booleans: true,
  };

  // When a boolean word and digits are attached
  const booleanWord = await validateFlagValue({ spec, raw: "false" });
  const number = await validateFlagValue({ spec, raw: "7" });

  // Then the word is a boolean the schema never sees, and digits a number
  assertEquals(booleanWord, { ok: true, value: false });
  assertEquals(number, { ok: true, value: 7 });
});

Deno.test("validateFlagValue reads values with real Zod schemas", async () => {
  // Given Zod's coercing number and an enum
  const count = { kind: "string", schema: z.coerce.number() } as const;
  const color = {
    kind: "string",
    schema: z.enum(["always", "never"]),
  } as const;

  // When good and bad values are typed
  const goodCount = await validateFlagValue({ spec: count, raw: "3" });
  const badCount = await validateFlagValue({ spec: count, raw: "three" });
  const goodColor = await validateFlagValue({ spec: color, raw: "never" });
  const badColor = await validateFlagValue({ spec: color, raw: "auto" });

  // Then Zod's output is the value, and its messages are the issues
  assertEquals(goodCount, { ok: true, value: 3 });
  assertEquals(badCount, {
    ok: false,
    error: {
      kind: "refused",
      issues: [{ message: "Invalid input: expected number, received NaN" }],
    },
  });
  assertEquals(goodColor, { ok: true, value: "never" });
  assertEquals(badColor, {
    ok: false,
    error: {
      kind: "refused",
      issues: [{ message: 'Invalid option: expected one of "always"|"never"' }],
    },
  });
});

// A hand-written schema whose JSON Schema converter returns the given one.
function withJsonSchema(
  jsonSchema: () => Record<string, unknown>,
): StandardSchemaV1<string, string> & StandardJSONSchemaV1<string, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "fake",
      validate: (value) => ({ value: String(value) }),
      jsonSchema: { input: jsonSchema, output: jsonSchema },
    },
  };
}

Deno.test("schemaChoices reads string choices from enum, const, anyOf and oneOf", () => {
  // Given schemas whose JSON Schemas list choices four ways
  const fromEnum = withJsonSchema(() => ({ enum: ["a", "b"] }));
  const fromConst = withJsonSchema(() => ({ const: "only" }));
  const fromAnyOf = withJsonSchema(() => ({
    anyOf: [{ const: "x" }, { const: "y" }],
  }));
  const fromOneOf = withJsonSchema(() => ({
    oneOf: [{ type: "string", const: "p" }, { const: "q" }],
  }));

  // When their choices are read
  // Then each lists its strings in order
  assertEquals(schemaChoices(fromEnum), ["a", "b"]);
  assertEquals(schemaChoices(fromConst), ["only"]);
  assertEquals(schemaChoices(fromAnyOf), ["x", "y"]);
  assertEquals(schemaChoices(fromOneOf), ["p", "q"]);
});

// A schema whose `~standard` carries an arbitrary `jsonSchema` value, as a
// misbehaving library might: built off-literal so its shape isn't checked.
function withRawJsonSchema(jsonSchema: unknown): StandardSchemaV1<string> {
  const props = {
    version: 1 as const,
    vendor: "fake",
    validate: (value: unknown) => ({ value: String(value) }),
    jsonSchema,
  };
  return { "~standard": props };
}

Deno.test("schemaChoices survives a converter that misbehaves", async () => {
  // Given a getter that throws, and converters returning null, a string,
  // and a promise (one resolving, one rejecting)
  const props = {
    version: 1 as const,
    vendor: "fake",
    validate: (value: unknown) => ({ value: String(value) }),
    get jsonSchema(): unknown {
      throw new Error("getter exploded");
    },
  };
  const throwingGetter: StandardSchemaV1<string> = { "~standard": props };
  const returnsNull = withRawJsonSchema({ input: () => null });
  const returnsText = withRawJsonSchema({ input: () => "enum" });
  const returnsPromise = withRawJsonSchema({
    input: () => Promise.resolve({ enum: ["a"] }),
  });
  const returnsRejection = withRawJsonSchema({
    input: () => Promise.reject(new Error("async by mistake")),
  });

  // When their choices are read
  const choices = [
    throwingGetter,
    returnsNull,
    returnsText,
    returnsPromise,
    returnsRejection,
  ].map((schema) => schemaChoices(schema));
  await Promise.resolve();

  // Then none crashes or lists choices, and the rejection stays handled
  assertEquals(choices, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

Deno.test("schemaChoices lists nothing it can't read as string choices", () => {
  // Given a schema with no converter, one whose converter throws, and
  // JSON Schemas that are open, mixed, or not all consts
  const throwing = withJsonSchema(() => {
    throw new Error("transforms can't be represented");
  });
  const open = withJsonSchema(() => ({ type: "number" }));
  const mixed = withJsonSchema(() => ({ enum: ["a", 1] }));
  const partial = withJsonSchema(() => ({
    anyOf: [{ const: "a" }, { type: "string" }],
  }));
  const empty = withJsonSchema(() => ({ enum: [] }));

  // When their choices are read
  // Then none is listed, and the throw doesn't escape
  assertEquals(schemaChoices(digits), undefined);
  assertEquals(schemaChoices(throwing), undefined);
  assertEquals(schemaChoices(open), undefined);
  assertEquals(schemaChoices(mixed), undefined);
  assertEquals(schemaChoices(partial), undefined);
  assertEquals(schemaChoices(empty), undefined);
});

Deno.test("describeFlagValue picks valueName, then choices, then a schema's, then a placeholder", () => {
  // Given a schema that lists choices and one that doesn't
  const listed = withJsonSchema(() => ({ enum: ["always", "never"] }));

  // When each kind of slot is described
  // Then the first rule that applies wins
  assertEquals(
    describeFlagValue({ kind: "string", schema: listed, valueName: "when" }),
    "<when>",
  );
  assertEquals(
    describeFlagValue({ kind: "string", schema: listed }),
    "<always|never>",
  );
  assertEquals(
    describeFlagValue({ kind: "collect", schema: digits }),
    "<value>",
  );
  assertEquals(describeFlagValue({ kind: "string" }), "<string>");
  assertEquals(describeFlagValue({ kind: "collect" }), "<collect>");
});

Deno.test("describeFlagValue lists an optional-value schema's choices after the booleans", () => {
  // Given optional-value flags with booleans and a listing or opaque schema
  const listed = withJsonSchema(() => ({ enum: ["auto"] }));

  // When described for usage
  const withChoices = describeFlagValue({
    kind: "optional-value",
    schema: listed,
    booleans: true,
  });
  const opaque = describeFlagValue({
    kind: "optional-value",
    schema: digits,
    booleans: true,
  });

  // Then the booleans come first, then the choices or <value>
  assertEquals(withChoices, "true|false|auto");
  assertEquals(opaque, "true|false|<value>");
});

Deno.test("describeFlagValue reads choices from Zod's own JSON Schema", () => {
  // Given Zod schemas: an enum, a literal union, and a coercing number
  // When each is described for usage
  // Then the enum and the union list their choices, the number a placeholder
  assertEquals(
    describeFlagValue({ kind: "string", schema: z.enum(["a", "b"]) }),
    "<a|b>",
  );
  assertEquals(
    describeFlagValue({
      kind: "optional-value",
      schema: z.union([z.literal("x"), z.literal("y")]),
    }),
    "x|y",
  );
  assertEquals(
    describeFlagValue({ kind: "string", schema: z.coerce.number() }),
    "<value>",
  );
});
