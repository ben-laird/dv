import { assertEquals } from "@std/assert";
import {
  checkFlagSpecMap,
  describeFlagSpecError,
  type FlagSpec,
  lowerFlagSpec,
} from "./flag-spec.ts";

Deno.test("checkFlagSpecMap refuses an optional-value flag beside its no- twin", () => {
  // Given maat's old shape: an optional-value flag plus a separate no- boolean
  const flagSpecMap: Record<string, FlagSpec> = {
    ask: { kind: "optional-value", values: ["null"] },
    "no-ask": { kind: "boolean" },
  };

  // When the map is checked
  const check = checkFlagSpecMap(flagSpecMap);

  // Then the collision is an error value telling the author to drop no-ask
  assertEquals(check, {
    ok: false,
    error: {
      kind: "negation-collision",
      flagName: "ask",
      negatedFlagName: "no-ask",
    },
  });
  if (!check.ok) {
    assertEquals(
      describeFlagSpecError(check.error),
      "flag 'no-ask' collides with optional-value flag 'ask', which already reads '--no-ask' as false; drop the separate 'no-ask' flag",
    );
  }
});

Deno.test("checkFlagSpecMap refuses a boolean spelling declared in values beside booleans", () => {
  // Given an optional-value flag that reads booleans and also lists "false"
  const flagSpecMap: Record<string, FlagSpec> = {
    ask: { kind: "optional-value", values: ["null", "false"], booleans: true },
  };

  // When the map is checked
  const check = checkFlagSpecMap(flagSpecMap);

  // Then the unreachable "false" literal is an error value
  assertEquals(check, {
    ok: false,
    error: {
      kind: "boolean-spelling-in-values",
      flagName: "ask",
      value: "false",
    },
  });
  if (!check.ok) {
    assertEquals(
      describeFlagSpecError(check.error),
      "optional-value flag 'ask' declares 'false' in values, but booleans: true already reads '--ask=false' as a boolean; drop 'false' from values",
    );
  }
});

Deno.test("checkFlagSpecMap refuses an optional-value flag named as another flag's negation", () => {
  // Given a boolean `foo` and an optional-value flag named `no-foo`
  const flagSpecMap: Record<string, FlagSpec> = {
    foo: { kind: "boolean" },
    "no-foo": { kind: "optional-value" },
  };

  // When the map is checked
  const check = checkFlagSpecMap(flagSpecMap);

  // Then the mirror collision is an error value naming the rename
  assertEquals(check, {
    ok: false,
    error: {
      kind: "negated-name-collision",
      flagName: "no-foo",
      baseFlagName: "foo",
    },
  });
  if (!check.ok) {
    assertEquals(
      describeFlagSpecError(check.error),
      "optional-value flag 'no-foo' collides with flag 'foo': '--no-foo' reads as the negation of 'foo'; rename the optional-value flag so it doesn't start with 'no-'",
    );
  }
});

Deno.test("checkFlagSpecMap accepts no- flags that shadow nothing", () => {
  // Given a no- boolean beside a plain boolean of the same stem, and an
  // optional-value flag whose own name starts with no-
  const flagSpecMap: Record<string, FlagSpec> = {
    color: { kind: "boolean" },
    "no-color": { kind: "boolean" },
    "no-verify": { kind: "optional-value", values: ["hooks"] },
  };

  // When the map is checked
  const check = checkFlagSpecMap(flagSpecMap);

  // Then it passes: `verify` isn't declared, so `no-verify` claims nothing
  // another flag needs, and only an optional-value stem claims `--no-<stem>`
  assertEquals(check, { ok: true });
});

Deno.test("lowerFlagSpec assigns each flag to its kind's array", () => {
  // Given one flag of each kind
  const flagSpecMap: Record<string, FlagSpec> = {
    message: { kind: "string" },
    json: { kind: "boolean" },
    packages: { kind: "collect" },
  };

  // When lowered
  const lowered = lowerFlagSpec(flagSpecMap);

  // Then each flag lands in its own bucket; collect also appears in
  // `string` because parseArgs needs both to make a flag repeatable
  // with a string value
  assertEquals(lowered.string, ["message", "packages"]);
  assertEquals(lowered.boolean, ["json"]);
  assertEquals(lowered.collect, ["packages"]);
  assertEquals(lowered.alias, {});
});

Deno.test("lowerFlagSpec flattens aliases into a single short→long map", () => {
  // Given two flags with single-char aliases
  const flagSpecMap: Record<string, FlagSpec> = {
    help: { kind: "boolean", alias: "h" },
    yes: { kind: "boolean", alias: "y" },
  };

  // When lowered
  const lowered = lowerFlagSpec(flagSpecMap);

  // Then aliases collapse into one flat record
  assertEquals(lowered.alias, { h: "help", y: "yes" });
});

Deno.test("lowerFlagSpec returns empty arrays for an empty flag map", () => {
  // Given no declared flags
  // When lowered
  const lowered = lowerFlagSpec({});

  // Then every output bucket is empty
  assertEquals(lowered, {
    string: [],
    boolean: [],
    collect: [],
    optionalValue: [],
    alias: {},
  });
});

Deno.test("lowerFlagSpec keeps optional-value flags out of every parseArgs bucket", () => {
  // Given an optional-value flag beside a boolean
  const flagSpecMap: Record<string, FlagSpec> = {
    askOnCommit: { kind: "optional-value", values: ["null"] },
    json: { kind: "boolean" },
  };

  // When lowered
  const lowered = lowerFlagSpec(flagSpecMap);

  // Then it is listed only under optionalValue, since parseArgs would
  // otherwise read `--askOnCommit word` as taking `word` (or `false`)
  assertEquals(lowered.optionalValue, ["askOnCommit"]);
  assertEquals(lowered.string, []);
  assertEquals(lowered.boolean, ["json"]);
  assertEquals(lowered.collect, []);
});
