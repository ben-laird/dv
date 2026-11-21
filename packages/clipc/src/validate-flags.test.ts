import { assertEquals } from "@std/assert";
import type { FlagSpec } from "./flag-spec.ts";
import { validateFlagValues } from "./validate-flags.ts";

const askFlags = {
  ask: { kind: "optional-value", choices: ["null"], booleans: true },
  title: { kind: "string" },
} satisfies Record<string, FlagSpec>;

Deno.test("validateFlagValues puts each checked value in place of its raw text", async () => {
  // Given raw lexed flags for a boolean word and a free string
  const flags = { ask: "true", title: "hello" };

  // When their values are validated
  const outcome = await validateFlagValues({
    flagSpecMap: askFlags,
    flags,
    values: [
      { flagName: "ask", raw: "true", slot: { kind: "value" } },
      { flagName: "title", raw: "hello", slot: { kind: "value" } },
    ],
  });

  // Then the boolean word reads as a boolean, and the string is unchanged
  assertEquals(outcome, { ok: true, flags: { ask: true, title: "hello" } });
});

Deno.test("validateFlagValues checks nothing for an absent flag", async () => {
  // Given no values were typed
  // When the empty list is validated
  const outcome = await validateFlagValues({
    flagSpecMap: askFlags,
    flags: {},
    values: [],
  });

  // Then the flags stay empty and nothing is refused
  assertEquals(outcome, { ok: true, flags: {} });
});

Deno.test("validateFlagValues reports the first refusal in argv order", async () => {
  // Given an overridden bad spelling before a good final one
  const flags = { ask: "null" };

  // When validated
  const outcome = await validateFlagValues({
    flagSpecMap: askFlags,
    flags,
    values: [
      { flagName: "ask", raw: "bad", slot: { kind: "overridden" } },
      { flagName: "ask", raw: "null", slot: { kind: "value" } },
    ],
  });

  // Then the earlier spelling is refused: every typed value is checked
  assertEquals(outcome, {
    ok: false,
    error: {
      kind: "invalid-flag-value",
      flagName: "ask",
      value: "bad",
      issues: [{ message: "expected one of: true|false|null" }],
      allowedValues: ["true", "false", "null"],
    },
  });
});
