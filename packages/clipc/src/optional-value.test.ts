import { assertEquals } from "@std/assert";
import {
  describeOptionalValue,
  type OptionalValueFlagSpec,
  validateOptionalValue,
} from "./optional-value.ts";

const closedSet: OptionalValueFlagSpec = {
  kind: "optional-value",
  values: ["null"],
};
const closedSetWithBooleans: OptionalValueFlagSpec = {
  kind: "optional-value",
  values: ["null"],
  booleans: true,
};
const freeString: OptionalValueFlagSpec = { kind: "optional-value" };

Deno.test("validateOptionalValue accepts a declared value as written", () => {
  // Given a closed set of one value
  // When that value is attached
  const validation = validateOptionalValue({ spec: closedSet, raw: "null" });

  // Then it is accepted unchanged
  assertEquals(validation, { ok: true, value: "null" });
});

Deno.test("validateOptionalValue refuses an undeclared value with one issue and the set", () => {
  // Given a closed set without booleans
  // When `true` is attached
  const validation = validateOptionalValue({ spec: closedSet, raw: "true" });

  // Then it is refused: without booleans, `true` is just an undeclared word
  assertEquals(validation, {
    ok: false,
    issues: [{ message: "expected one of: null" }],
    allowedValues: ["null"],
  });
});

Deno.test("validateOptionalValue reads true and false as booleans when booleans is on", () => {
  // Given a closed set with booleans
  // When each boolean word is attached
  const trueValue = validateOptionalValue({
    spec: closedSetWithBooleans,
    raw: "true",
  });
  const falseValue = validateOptionalValue({
    spec: closedSetWithBooleans,
    raw: "false",
  });

  // Then they become the booleans, not the strings
  assertEquals(trueValue, { ok: true, value: true });
  assertEquals(falseValue, { ok: true, value: false });
});

Deno.test("validateOptionalValue accepts any text when no values are declared", () => {
  // Given a free-string spec
  for (const raw of ["", "true", "a=b", "anything"]) {
    // When the text is attached
    const validation = validateOptionalValue({ spec: freeString, raw });

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
    values: ["null"],
    booleans: true,
    valueName: "setting",
  };

  // When described for usage
  // Then the name stands in for the set
  assertEquals(describeOptionalValue(spec), "<setting>");
});
