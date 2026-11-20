import { assertEquals, fail } from "@std/assert";
import type { FlagSpec } from "./flag-spec.ts";
import {
  type ParsedSubcommandArgv,
  type ParseSubcommandArgvArgs,
  parseSubcommandArgv,
} from "./parse-subcommand.ts";

// Unwraps an outcome the test expects to succeed, failing loudly otherwise.
function parseOk<TFlagMap extends Record<string, FlagSpec>>(
  args: ParseSubcommandArgvArgs<TFlagMap>,
): ParsedSubcommandArgv<TFlagMap> {
  const outcome = parseSubcommandArgv(args);
  if (!outcome.ok) {
    fail(`expected a parse, got ${JSON.stringify(outcome.error)}`);
  }
  return outcome.value;
}

Deno.test("parseSubcommandArgv routes declared flags into the typed flags object", () => {
  // Given a flag map with one string, one boolean, and one collect flag
  const flagSpecMap = {
    message: { kind: "string" },
    json: { kind: "boolean" },
    packages: { kind: "collect" },
  } satisfies Record<string, FlagSpec>;

  // When argv exercises all three
  const parsed = parseOk({
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
  const parsed = parseOk({
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
  const parsed = parseOk({
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
  const spaced = parseOk({
    flagSpecMap,
    subcommandArgv: ["--id", "007"],
  });
  const joined = parseOk({
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
  const parsed = parseOk({
    flagSpecMap,
    subcommandArgv: ["--", "--help", "-h"],
  });

  // Then they are positionals, not unknown flags
  assertEquals(parsed.argv, ["--help", "-h"]);
});

Deno.test("parseSubcommandArgv keeps a bare `-` as a positional word", () => {
  // Given a leaf with one switch
  const flagSpecMap = {
    json: { kind: "boolean" },
  } satisfies Record<string, FlagSpec>;

  // When `-` comes alone, before the switch, after it, and between words
  const alone = parseOk({ flagSpecMap, subcommandArgv: ["-"] });
  const mixed = parseOk({
    flagSpecMap,
    subcommandArgv: ["-", "--json", "a", "-", "b"],
  });

  // Then every `-` is a word, in order, and the switch still parses
  assertEquals(alone.argv, ["-"]);
  assertEquals(alone.flags.json, false);
  assertEquals(mixed.argv, ["-", "a", "-", "b"]);
  assertEquals(mixed.flags.json, true);
});

Deno.test("parseSubcommandArgv gives a value flag `-` as its value, spaced or joined", () => {
  // Given a string flag with a short alias and a collect flag
  const flagSpecMap = {
    title: { kind: "string", alias: "t" },
    packages: { kind: "collect" },
  } satisfies Record<string, FlagSpec>;

  // When `-` is each flag's value, in the long, short and joined forms
  const spellings = [
    ["--title", "-", "word"],
    ["-t", "-", "word"],
    ["--title=-", "word"],
  ];
  const parsedTitles = spellings.map((subcommandArgv) =>
    parseOk({ flagSpecMap, subcommandArgv }),
  );
  const parsedPackages = parseOk({
    flagSpecMap,
    subcommandArgv: ["--packages", "-", "--packages", "a"],
  });

  // Then every spelling sets the value to `-` and leaves the word alone
  for (const parsed of parsedTitles) {
    assertEquals(parsed.flags.title, "-");
    assertEquals(parsed.argv, ["word"]);
  }
  assertEquals(parsedPackages.flags.packages, ["-", "a"]);
  assertEquals(parsedPackages.argv, []);
});

Deno.test("parseSubcommandArgv leaves `--title -` after `--` as words", () => {
  // Given a leaf with a string flag
  const flagSpecMap = {
    title: { kind: "string" },
  } satisfies Record<string, FlagSpec>;

  // When the flag and `-` follow `--`
  const parsed = parseOk({
    flagSpecMap,
    subcommandArgv: ["--", "--title", "-"],
  });

  // Then both are words and the flag is unset
  assertEquals(parsed.argv, ["--title", "-"]);
  assertEquals(parsed.flags.title, undefined);
});

Deno.test("parseSubcommandArgv still refuses -x, --x and -5 beside a bare `-`", () => {
  // Given a leaf that declares none of them
  const flagSpecMap = {} satisfies Record<string, FlagSpec>;

  for (const token of ["-x", "--x", "-5"]) {
    // When it follows a bare `-`
    const outcome = parseSubcommandArgv({
      flagSpecMap,
      subcommandArgv: ["-", token],
    });

    // Then the unknown-flag error names that token, not `-`
    assertEquals(outcome, {
      ok: false,
      error: { kind: "unknown-flag", flagToken: token },
    });
  }
});

Deno.test("parseSubcommandArgv resolves aliases without leaking the short key into flags", () => {
  // Given a flag with a single-char alias
  const flagSpecMap = {
    help: { kind: "boolean", alias: "h" },
  } satisfies Record<string, FlagSpec>;

  // When -h is passed
  const parsed = parseOk({
    flagSpecMap,
    subcommandArgv: ["-h"],
  });

  // Then the long-form key is set and the short-form does not appear
  // as its own key
  assertEquals(parsed.flags.help, true);
  assertEquals("h" in parsed.flags, false);
});

Deno.test("parseSubcommandArgv returns an unknown-flag error when an undeclared flag appears", () => {
  // Given a flag map with no declared --whatever
  const flagSpecMap = {
    yes: { kind: "boolean" },
  } satisfies Record<string, FlagSpec>;

  // When argv carries an unknown flag
  const outcome = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--whatever"],
  });

  // Then the error value carries the offending token
  assertEquals(outcome, {
    ok: false,
    error: { kind: "unknown-flag", flagToken: "--whatever" },
  });
});

Deno.test("parseSubcommandArgv names the first of several unknown flags", () => {
  // Given a leaf that declares no flags
  const flagSpecMap = {} satisfies Record<string, FlagSpec>;

  // When argv carries two unknown flags
  const outcome = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["word", "--first", "--second"],
  });

  // Then the error names the first one typed
  assertEquals(outcome, {
    ok: false,
    error: { kind: "unknown-flag", flagToken: "--first" },
  });
});

// An optional-value flag: maat's `--askOnCommit`, which can also reset to null.
// `as const` keeps `"null"` literal, as the builders' `const` type params do.
const askOnCommitFlags = {
  askOnCommit: { kind: "optional-value", values: ["null"] },
  title: { kind: "string" },
  json: { kind: "boolean" },
} as const satisfies Record<string, FlagSpec>;

Deno.test("parseSubcommandArgv reads an optional-value flag's three spellings", () => {
  // Given an optional-value flag declaring the value `null`
  const flagSpecMap = askOnCommitFlags;

  // When it is written bare, negated, and with its value attached
  const bare = parseOk({ flagSpecMap, subcommandArgv: ["--askOnCommit"] });
  const negated = parseOk({
    flagSpecMap,
    subcommandArgv: ["--no-askOnCommit"],
  });
  const attached = parseOk({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit=null"],
  });

  // Then they read as true, false, and the declared value
  assertEquals(bare.flags.askOnCommit, true);
  assertEquals(negated.flags.askOnCommit, false);
  assertEquals(attached.flags.askOnCommit, "null");
  for (const parsed of [bare, negated, attached]) {
    assertEquals(parsed.argv, []);
  }
});

Deno.test("parseSubcommandArgv leaves an absent optional-value flag undefined", () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When argv doesn't mention it
  const parsed = parseOk({ flagSpecMap, subcommandArgv: ["word"] });

  // Then it is undefined, so "not given" differs from `--no-askOnCommit`
  assertEquals(parsed.flags.askOnCommit, undefined);
  assertEquals("askOnCommit" in parsed.flags, false);
});

Deno.test("parseSubcommandArgv never gives an optional-value flag the next word", () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When a separate word follows it, including a declared value or a boolean
  for (const nextWord of ["null", "foo", "true", "false", "-"]) {
    const parsed = parseOk({
      flagSpecMap,
      subcommandArgv: ["--askOnCommit", nextWord],
    });

    // Then the flag is just switched on and the word stays positional
    assertEquals(parsed.flags.askOnCommit, true);
    assertEquals(parsed.argv, [nextWord]);
  }
});

Deno.test("parseSubcommandArgv keeps the last spelling of a repeated optional-value flag", () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When it is written several times
  const valueLast = parseOk({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit", "--no-askOnCommit", "--askOnCommit=null"],
  });
  const switchLast = parseOk({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit=null", "--askOnCommit"],
  });

  // Then the last one written wins
  assertEquals(valueLast.flags.askOnCommit, "null");
  assertEquals(switchLast.flags.askOnCommit, true);
});

Deno.test("parseSubcommandArgv leaves the flags around an optional-value flag unchanged", () => {
  // Given an optional-value flag beside a string and a boolean flag
  const flagSpecMap = askOnCommitFlags;

  // When a string flag directly precedes it, and a word follows
  const parsed = parseOk({
    flagSpecMap,
    subcommandArgv: ["--title", "--askOnCommit", "word", "--json"],
  });

  // Then the string flag reads empty, as before any flag, not the word
  assertEquals(parsed.flags.title, "");
  assertEquals(parsed.flags.askOnCommit, true);
  assertEquals(parsed.flags.json, true);
  assertEquals(parsed.argv, ["word"]);
});

Deno.test("parseSubcommandArgv refuses an undeclared attached value", () => {
  // Given an optional-value flag declaring only `null`
  const flagSpecMap = askOnCommitFlags;

  for (const value of ["foo", "", "true", "NULL", "null=x"]) {
    // When another value is attached
    const outcome = parseSubcommandArgv({
      flagSpecMap,
      subcommandArgv: [`--askOnCommit=${value}`],
    });

    // Then an invalid-flag-value error names the flag, value and choices
    assertEquals(outcome, {
      ok: false,
      error: {
        kind: "invalid-flag-value",
        flagName: "askOnCommit",
        value,
        allowedValues: ["null"],
      },
    });
  }
});

Deno.test("parseSubcommandArgv refuses a value attached to the negated spelling", () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When a value is attached to `--no-askOnCommit`
  const outcome = parseSubcommandArgv({
    flagSpecMap,
    subcommandArgv: ["--no-askOnCommit=null"],
  });

  // Then it is an unknown flag, not a quiet `--askOnCommit=null`
  assertEquals(outcome, {
    ok: false,
    error: { kind: "unknown-flag", flagToken: "--no-askOnCommit=null" },
  });
});

Deno.test("parseSubcommandArgv leaves optional-value spellings after `--` as words", () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When its spellings follow `--`, even an undeclared value
  const parsed = parseOk({
    flagSpecMap,
    subcommandArgv: ["--", "--askOnCommit=foo", "--no-askOnCommit"],
  });

  // Then they are words and the flag is unset
  assertEquals(parsed.argv, ["--askOnCommit=foo", "--no-askOnCommit"]);
  assertEquals(parsed.flags.askOnCommit, undefined);
});

Deno.test("parseSubcommandArgv reads an optional-value flag whose name starts with no-", () => {
  // Given an optional-value flag named like a negation
  const flagSpecMap = {
    "no-verify": { kind: "optional-value", values: ["hooks"] },
  } as const satisfies Record<string, FlagSpec>;

  // When it is written bare, with its value, and negated
  const bare = parseOk({ flagSpecMap, subcommandArgv: ["--no-verify"] });
  const attached = parseOk({
    flagSpecMap,
    subcommandArgv: ["--no-verify=hooks"],
  });
  const negated = parseOk({ flagSpecMap, subcommandArgv: ["--no-no-verify"] });

  // Then each reads under its own name, never as an unknown flag
  assertEquals(bare.flags["no-verify"], true);
  assertEquals(attached.flags["no-verify"], "hooks");
  assertEquals(negated.flags["no-verify"], false);
});

Deno.test("parseSubcommandArgv keeps a dotted optional-value name flat", () => {
  // Given an optional-value flag whose name has a dot
  const flagSpecMap = {
    "cache.mode": { kind: "optional-value", values: ["off"] },
  } as const satisfies Record<string, FlagSpec>;

  // When it is given its value
  const parsed = parseOk({
    flagSpecMap,
    subcommandArgv: ["--cache.mode=off"],
  });

  // Then the flags hold exactly that key, with no nested stray
  assertEquals(parsed.flags, { "cache.mode": "off" });
});

Deno.test("parseSubcommandArgv accepts each of several declared values", () => {
  // Given an optional-value flag with three declared values
  const flagSpecMap = {
    color: { kind: "optional-value", values: ["always", "never", "auto"] },
  } satisfies Record<string, FlagSpec>;

  for (const value of flagSpecMap.color.values) {
    // When that value is attached
    const parsed = parseOk({
      flagSpecMap,
      subcommandArgv: [`--color=${value}`],
    });

    // Then the flag carries exactly that value
    assertEquals(parsed.flags.color, value);
  }
});

Deno.test("FlagsOf types an optional-value flag as boolean or a declared value", () => {
  // Given an optional-value flag declaring `null`
  const flagSpecMap = askOnCommitFlags;

  // When parsed
  const parsed = parseOk({ flagSpecMap, subcommandArgv: ["--askOnCommit"] });

  // Then the type admits exactly boolean, the literal, and undefined
  const askOnCommit: boolean | "null" | undefined = parsed.flags.askOnCommit;
  // @ts-expect-error: the declared literal is in the type, so this is too narrow
  const switchOnly: boolean | undefined = parsed.flags.askOnCommit;
  assertEquals([askOnCommit, switchOnly], [true, true]);
});
