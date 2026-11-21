import { assertEquals } from "@std/assert";
import {
  describeOptionalValue,
  type OptionalValueFlagSpec,
  validateFlagValue,
} from "./flag-value.ts";

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
