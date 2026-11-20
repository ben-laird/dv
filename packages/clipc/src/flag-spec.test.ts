import { assertEquals } from "@std/assert";
import { type FlagSpec, lowerFlagSpec } from "./flag-spec.ts";

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
