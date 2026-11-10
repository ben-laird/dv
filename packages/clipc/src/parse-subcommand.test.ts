import { assertEquals, assertThrows } from "@std/assert";
import type { FlagSpec } from "./flag-spec.ts";
import { parseSubcommandArgv, UnknownFlagError } from "./parse-subcommand.ts";

Deno.test("parseSubcommandArgv routes declared flags into the typed flags object", () => {
  // Given a flag map with one string, one boolean, and one collect flag
  const flagSpecMap = {
    message: { kind: "string" },
    json: { kind: "boolean" },
    packages: { kind: "collect" },
  } satisfies Record<string, FlagSpec>;

  // When argv exercises all three
  const parsed = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: [
      "--message",
      "hi",
      "--json",
      "--packages",
      "a",
      "--packages",
      "b",
    ],
  });

  // Then the typed flags carry their declared kind shapes
  assertEquals(parsed.flags.message, "hi");
  assertEquals(parsed.flags.json, true);
  assertEquals(parsed.flags.packages, ["a", "b"]);
  assertEquals(parsed.argv, []);
});

Deno.test("parseSubcommandArgv keeps positional tokens in argv", () => {
  // Given a runner that takes two positional args plus a boolean flag
  const flagSpecMap = {
    yes: { kind: "boolean" },
  } satisfies Record<string, FlagSpec>;

  // When argv mixes flags and positionals
  const parsed = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["old-name", "--yes", "new-name"],
  });

  // Then positionals land in argv in their original order
  assertEquals(parsed.argv, ["old-name", "new-name"]);
  assertEquals(parsed.flags.yes, true);
});

Deno.test("parseSubcommandArgv keeps positionals that look like numbers as the exact strings typed", () => {
  // Given a leaf with no flags, and words that parseArgs would read as numbers
  const flagSpecMap = {} satisfies Record<string, FlagSpec>;
  const numberLikeWords = ["007", "01234567", "1e3", "0x10", "Infinity"];

  // When they arrive as positionals, before and after `--` (where `-5` must go)
  const parsed = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: [...numberLikeWords, "--", "-5", "007"],
  });

  // Then every word reaches the leaf unchanged, still a string
  assertEquals(parsed.argv, [...numberLikeWords, "-5", "007"]);
});

Deno.test("parseSubcommandArgv keeps a string flag's number-like value as typed", () => {
  // Given a leaf with a declared string flag
  const flagSpecMap = {
    id: { kind: "string" },
  } satisfies Record<string, FlagSpec>;

  // When its value looks like a number, spaced and joined with `=`
  const spaced = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--id", "007"],
  });
  const joined = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--id=01234567"],
  });

  // Then the value is the exact string typed
  assertEquals(spaced.flags.id, "007");
  assertEquals(joined.flags.id, "01234567");
});

Deno.test("parseSubcommandArgv passes --help and -h after `--` through as words", () => {
  // Given a leaf with no flags
  const flagSpecMap = {} satisfies Record<string, FlagSpec>;

  // When help tokens follow `--`
  const parsed = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--", "--help", "-h"],
  });

  // Then they are positionals, not unknown flags
  assertEquals(parsed.argv, ["--help", "-h"]);
});

Deno.test("parseSubcommandArgv resolves aliases without leaking the short key into flags", () => {
  // Given a flag with a single-char alias
  const flagSpecMap = {
    help: { kind: "boolean", alias: "h" },
  } satisfies Record<string, FlagSpec>;

  // When -h is passed
  const parsed = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["-h"],
  });

  // Then the long-form key is set and the short-form does not appear
  // as its own key
  assertEquals(parsed.flags.help, true);
  assertEquals("h" in parsed.flags, false);
});

Deno.test("parseSubcommandArgv throws UnknownFlagError when an undeclared flag appears", () => {
  // Given a flag map with no declared --whatever
  const flagSpecMap = {
    yes: { kind: "boolean" },
  } satisfies Record<string, FlagSpec>;

  // When argv carries an unknown flag
  // Then UnknownFlagError surfaces carrying the offending token
  const caught = assertThrows(
    () =>
      parseSubcommandArgv({
        flagSpecMap,
        subcommandArgv: ["--whatever"],
      }),
    UnknownFlagError,
  );
  assertEquals(caught.flagToken, "--whatever");
});
