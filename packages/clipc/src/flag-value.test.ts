import { assertEquals } from "@std/assert";
import { z } from "zod";
import {
  describeOptionalValue,
  type OptionalValueFlagSpec,
  validateFlagValue,
} from "./flag-value.ts";
import type {
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
    issues: [{ message: "expected one of: null" }],
    allowedValues: ["null"],
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

Deno.test("describeOptionalValue names every accepted spelling", () => {
  // Given each shape of the vocabulary
  // When described for usage
  // Then booleans come first, then the set, with <string> for free text
  assertEquals(describeOptionalValue(closedSet), "null");
  assertEquals(describeOptionalValue(closedSetWithBooleans), "true|false|null");
  assertEquals(describeOptionalValue(freeString), "<string>");
  assertEquals(
    describeOptionalValue({ kind: "optional-value", booleans: true }),
    "true|false|<string>",
  );
});

Deno.test("describeOptionalValue lets valueName replace the listing", () => {
  // Given a closed set that also names its value
  const spec: OptionalValueFlagSpec = {
    kind: "optional-value",
    choices: ["null"],
    booleans: true,
    valueName: "setting",
  };

  // When described for usage
  // Then the name stands in for the set
  assertEquals(describeOptionalValue(spec), "<setting>");
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
    issues: [{ message: "expected digits" }],
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
    issues: [{ message: "the value was refused" }],
  });
});

Deno.test("validateFlagValue turns a schema that throws or rejects into a refusal", async () => {
  // Given a schema that throws and one whose promise rejects
  const throwing = fakeSchema(() => {
    throw new Error("boom");
  });
  const rejecting = fakeSchema(() => Promise.reject("no network"));

  // When each checks a value
  const thrown = await validateFlagValue({
    spec: { kind: "string", schema: throwing },
    raw: "x",
  });
  const rejected = await validateFlagValue({
    spec: { kind: "optional-value", schema: rejecting },
    raw: "x",
  });

  // Then neither escapes: each is a refusal naming what the schema said
  assertEquals(thrown, {
    ok: false,
    issues: [{ message: "the flag's schema threw: boom" }],
  });
  assertEquals(rejected, {
    ok: false,
    issues: [{ message: "the flag's schema threw: no network" }],
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
    issues: [{ message: "Invalid input: expected number, received NaN" }],
  });
  assertEquals(goodColor, { ok: true, value: "never" });
  assertEquals(badColor, {
    ok: false,
    issues: [{ message: 'Invalid option: expected one of "always"|"never"' }],
  });
});
