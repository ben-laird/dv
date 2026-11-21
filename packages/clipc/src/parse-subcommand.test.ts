import { assertEquals } from "@std/assert";
import type { FlagSpec } from "./flag-spec.ts";
import { parseSubcommandArgv } from "./parse-subcommand.ts";

const mixedFlags = {
  title: { kind: "string", alias: "t" },
  pkg: { kind: "collect", alias: "p" },
  ask: { kind: "optional-value", choices: ["null"], booleans: true },
  json: { kind: "boolean" },
} satisfies Record<string, FlagSpec>;

Deno.test("parseSubcommandArgv leaves every flag value as the raw text typed", () => {
  // Given an optional-value flag that reads booleans and declares choices
  const flagSpecMap = mixedFlags;

  // When an undeclared word and a boolean word are attached
  const undeclared = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--ask=nope"],
  });
  const booleanWord = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--ask=true"],
  });

  // Then the lexer refuses neither: both stay text for validation to read
  assertEquals(undeclared.ok && undeclared.value.flags.ask, "nope");
  assertEquals(booleanWord.ok && booleanWord.value.flags.ask, "true");
});

Deno.test("parseSubcommandArgv lists the values to validate in argv order", () => {
  // Given a string, a collect and an optional-value flag
  const flagSpecMap = mixedFlags;

  // When their values interleave, through long and short spellings
  const outcome = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--pkg", "a", "-t", "x", "--json", "--ask=1", "-p", "b"],
  });

  // Then each value is listed where it was typed, with where it goes
  assertEquals(outcome.ok && outcome.value.values, [
    { flagName: "pkg", raw: "a", slot: { kind: "element", index: 0 } },
    { flagName: "title", raw: "x", slot: { kind: "value" } },
    { flagName: "ask", raw: "1", slot: { kind: "value" } },
    { flagName: "pkg", raw: "b", slot: { kind: "element", index: 1 } },
  ]);
});

Deno.test("parseSubcommandArgv marks an optional-value spelling a later one overrode", () => {
  // Given an optional-value flag
  const flagSpecMap = mixedFlags;

  // When it is given a value, then switched on
  const outcome = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--ask=first", "--ask=second", "--ask"],
  });

  // Then both values are still listed, neither as the flag's value
  assertEquals(outcome.ok && outcome.value.values, [
    { flagName: "ask", raw: "first", slot: { kind: "overridden" } },
    { flagName: "ask", raw: "second", slot: { kind: "overridden" } },
  ]);
  assertEquals(outcome.ok && outcome.value.flags.ask, true);
});

Deno.test("parseSubcommandArgv keeps only the values typed before an unknown flag", () => {
  // Given a flag map without `--bogus`
  const flagSpecMap = mixedFlags;

  // When values come on both sides of it
  const outcome = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--ask=before", "--bogus", "--title", "after"],
  });

  // Then the error names it and carries only the value before it
  assertEquals(outcome, {
    ok: false,
    error: { kind: "unknown-flag", flagToken: "--bogus" },
    values: [{ flagName: "ask", raw: "before", slot: { kind: "value" } }],
  });
});
