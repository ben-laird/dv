import { assertEquals, fail } from "@std/assert";
import type { FlagSpec } from "./flag-spec.ts";
import {
  type ParseCommandArgvArgs,
  type ParsedCommandArgv,
  parseCommandArgv,
} from "./parse-command-argv.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";

// A hand-written schema that reads digits as a number.
const digits: StandardSchemaV1<string, number> = {
  "~standard": {
    version: 1,
    vendor: "fake",
    validate: (value) => {
      if (typeof value === "string" && /^\d+$/.test(value)) {
        return { value: Number(value) };
      }
      return { issues: [{ message: "expected digits" }] };
    },
  },
};

Deno.test("parseCommandArgv reports the first refused value in argv order across flags", async () => {
  // Given a string and a collect flag that both read digits
  const flagSpecMap = {
    count: { kind: "string", alias: "c", schema: digits },
    port: { kind: "collect", schema: digits },
  } satisfies Record<string, FlagSpec>;

  // When the collect's second value and the string's value are both bad
  const outcome = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--port", "80", "-c", "x", "--port", "y"],
  });

  // Then the string flag, typed first, is the one reported
  assertEquals(outcome, {
    ok: false,
    error: {
      kind: "invalid-flag-value",
      flagName: "count",
      value: "x",
      issues: [{ message: "expected digits" }],
    },
  });
});

Deno.test("parseCommandArgv checks every value typed for a string flag, keeping the last", async () => {
  // Given a string flag that reads digits
  const flagSpecMap = {
    num: { kind: "string", alias: "n", schema: digits },
  } satisfies Record<string, FlagSpec>;

  // When a bad value is overridden by a good one, and two good ones are typed
  const overridden = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--num", "a", "--num", "1"],
  });
  const repeated = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--num", "1", "-n", "2"],
  });

  // Then the overridden bad value is still refused, and the last good wins
  assertEquals(overridden, {
    ok: false,
    error: {
      kind: "invalid-flag-value",
      flagName: "num",
      value: "a",
      issues: [{ message: "expected digits" }],
    },
  });
  assertEquals(repeated.flags.num, 2);
});

Deno.test("parseCommandArgv places a value typed through its alias spelled long", async () => {
  // Given a string flag with the alias `n`, which parseArgs also reads as `--n`
  const flagSpecMap = {
    num: { kind: "string", alias: "n", schema: digits },
  } satisfies Record<string, FlagSpec>;

  // When a bad value typed as `--n` comes before an unknown flag
  const outcome = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--n", "a", "--bogus"],
  });

  // Then the value, typed first, is the error reported
  assertEquals(outcome, {
    ok: false,
    error: {
      kind: "invalid-flag-value",
      flagName: "num",
      value: "a",
      issues: [{ message: "expected digits" }],
    },
  });
});

Deno.test("parseCommandArgv reads flags named like Object.prototype keys", async () => {
  // Given a string flag named `valueOf` and a collect flag named `toString`,
  // both reading digits
  const flagSpecMap = {
    valueOf: { kind: "string", schema: digits },
    toString: { kind: "collect", schema: digits },
  } as const satisfies Record<string, FlagSpec>;

  // When each is typed, and when `--valueOf` names no alias
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--valueOf", "1", "--toString", "2", "--toString", "3"],
  });
  // `flags.valueOf` would read the method type, so read the own entries.
  const flagEntries = Object.fromEntries(Object.entries(parsed.flags));
  const refused = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--valueOf", "x", "--bogus"],
  });

  // Then only the typed values are read, never the inherited functions,
  // and `--valueOf` keeps its place in argv instead of reading as an alias
  assertEquals(flagEntries, { valueOf: 1, toString: [2, 3] });
  assertEquals(refused, {
    ok: false,
    error: {
      kind: "invalid-flag-value",
      flagName: "valueOf",
      value: "x",
      issues: [{ message: "expected digits" }],
    },
  });
});

Deno.test("parseCommandArgv leaves an absent string flag out of flags", async () => {
  // Given a string flag and a boolean
  const flagSpecMap = {
    title: { kind: "string" },
    json: { kind: "boolean" },
  } satisfies Record<string, FlagSpec>;

  // When only the boolean is typed
  const parsed = await parseOk({ flagSpecMap, subcommandArgv: ["--json"] });

  // Then the string flag has no key at all
  assertEquals(Object.hasOwn(parsed.flags, "title"), false);
});

Deno.test("parseCommandArgv names a collect flag's refused element", async () => {
  // Given a collect flag that reads digits
  const flagSpecMap = {
    port: { kind: "collect", alias: "p", schema: digits },
  } satisfies Record<string, FlagSpec>;

  // When its third value, typed through the alias, is bad
  const outcome = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--port=1", "-p", "2", "-p", "three"],
  });

  // Then the error carries the element's place, counting from 1
  assertEquals(outcome, {
    ok: false,
    error: {
      kind: "invalid-flag-value",
      flagName: "port",
      value: "three",
      element: 3,
      issues: [{ message: "expected digits" }],
    },
  });
});

// Unwraps an outcome the test expects to succeed, failing loudly otherwise.
async function parseOk<TFlagMap extends Record<string, FlagSpec>>(
  args: ParseCommandArgvArgs<TFlagMap>,
): Promise<ParsedCommandArgv<TFlagMap>> {
  const outcome = await parseCommandArgv(args);
  if (!outcome.ok) {
    fail(`expected a parse, got ${JSON.stringify(outcome.error)}`);
  }
  return outcome.value;
}

Deno.test("parseCommandArgv routes declared flags into the typed flags object", async () => {
  // Given a flag map with one string, one boolean, and one collect flag
  const flagSpecMap = {
    message: { kind: "string" },
    json: { kind: "boolean" },
    packages: { kind: "collect" },
  } satisfies Record<string, FlagSpec>;

  // When argv exercises all three
  const parsed = await parseOk({
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

Deno.test("parseCommandArgv keeps positional tokens in argv", async () => {
  // Given a runner that takes two positional args plus a boolean flag
  const flagSpecMap = {
    yes: { kind: "boolean" },
  } satisfies Record<string, FlagSpec>;

  // When argv mixes flags and positionals
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["old-name", "--yes", "new-name"],
  });

  // Then positionals land in argv in their original order
  assertEquals(parsed.argv, ["old-name", "new-name"]);
  assertEquals(parsed.flags.yes, true);
});

Deno.test("parseCommandArgv keeps positionals that look like numbers as the exact strings typed", async () => {
  // Given a leaf with no flags, and words that parseArgs would read as numbers
  const flagSpecMap = {} satisfies Record<string, FlagSpec>;
  const numberLikeWords = ["007", "01234567", "1e3", "0x10", "Infinity"];

  // When they arrive as positionals, before and after `--` (where `-5` must go)
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: [...numberLikeWords, "--", "-5", "007"],
  });

  // Then every word reaches the leaf unchanged, still a string
  assertEquals(parsed.argv, [...numberLikeWords, "-5", "007"]);
});

Deno.test("parseCommandArgv keeps a string flag's number-like value as typed", async () => {
  // Given a leaf with a declared string flag
  const flagSpecMap = {
    id: { kind: "string" },
  } satisfies Record<string, FlagSpec>;

  // When its value looks like a number, spaced and joined with `=`
  const spaced = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--id", "007"],
  });
  const joined = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--id=01234567"],
  });

  // Then the value is the exact string typed
  assertEquals(spaced.flags.id, "007");
  assertEquals(joined.flags.id, "01234567");
});

Deno.test("parseCommandArgv passes --help and -h after `--` through as words", async () => {
  // Given a leaf with no flags
  const flagSpecMap = {} satisfies Record<string, FlagSpec>;

  // When help tokens follow `--`
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--", "--help", "-h"],
  });

  // Then they are positionals, not unknown flags
  assertEquals(parsed.argv, ["--help", "-h"]);
});

Deno.test("parseCommandArgv keeps a bare `-` as a positional word", async () => {
  // Given a leaf with one switch
  const flagSpecMap = {
    json: { kind: "boolean" },
  } satisfies Record<string, FlagSpec>;

  // When `-` comes alone, before the switch, after it, and between words
  const alone = await parseOk({ flagSpecMap, subcommandArgv: ["-"] });
  const mixed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["-", "--json", "a", "-", "b"],
  });

  // Then every `-` is a word, in order, and the switch still parses
  assertEquals(alone.argv, ["-"]);
  assertEquals(alone.flags.json, false);
  assertEquals(mixed.argv, ["-", "a", "-", "b"]);
  assertEquals(mixed.flags.json, true);
});

Deno.test("parseCommandArgv gives a value flag `-` as its value, spaced or joined", async () => {
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
  const parsedTitles = await Promise.all(
    spellings.map((subcommandArgv) => parseOk({ flagSpecMap, subcommandArgv })),
  );
  const parsedPackages = await parseOk({
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

Deno.test("parseCommandArgv leaves `--title -` after `--` as words", async () => {
  // Given a leaf with a string flag
  const flagSpecMap = {
    title: { kind: "string" },
  } satisfies Record<string, FlagSpec>;

  // When the flag and `-` follow `--`
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--", "--title", "-"],
  });

  // Then both are words and the flag is unset
  assertEquals(parsed.argv, ["--title", "-"]);
  assertEquals(parsed.flags.title, undefined);
});

Deno.test("parseCommandArgv still refuses -x, --x and -5 beside a bare `-`", async () => {
  // Given a leaf that declares none of them
  const flagSpecMap = {} satisfies Record<string, FlagSpec>;

  for (const token of ["-x", "--x", "-5"]) {
    // When it follows a bare `-`
    const outcome = await parseCommandArgv({
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

Deno.test("parseCommandArgv resolves aliases without leaking the short key into flags", async () => {
  // Given a flag with a single-char alias
  const flagSpecMap = {
    help: { kind: "boolean", alias: "h" },
  } satisfies Record<string, FlagSpec>;

  // When -h is passed
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["-h"],
  });

  // Then the long-form key is set and the short-form does not appear
  // as its own key
  assertEquals(parsed.flags.help, true);
  assertEquals("h" in parsed.flags, false);
});

Deno.test("parseCommandArgv returns an unknown-flag error when an undeclared flag appears", async () => {
  // Given a flag map with no declared --whatever
  const flagSpecMap = {
    yes: { kind: "boolean" },
  } satisfies Record<string, FlagSpec>;

  // When argv carries an unknown flag
  const outcome = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--whatever"],
  });

  // Then the error value carries the offending token
  assertEquals(outcome, {
    ok: false,
    error: { kind: "unknown-flag", flagToken: "--whatever" },
  });
});

Deno.test("parseCommandArgv names the first of several unknown flags", async () => {
  // Given a leaf that declares no flags
  const flagSpecMap = {} satisfies Record<string, FlagSpec>;

  // When argv carries two unknown flags
  const outcome = await parseCommandArgv({
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
  askOnCommit: { kind: "optional-value", choices: ["null"] },
  title: { kind: "string" },
  json: { kind: "boolean" },
} as const satisfies Record<string, FlagSpec>;

Deno.test("parseCommandArgv reads an optional-value flag's three spellings", async () => {
  // Given an optional-value flag declaring the value `null`
  const flagSpecMap = askOnCommitFlags;

  // When it is written bare, negated, and with its value attached
  const bare = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit"],
  });
  const negated = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--no-askOnCommit"],
  });
  const attached = await parseOk({
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

Deno.test("parseCommandArgv leaves an absent optional-value flag undefined", async () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When argv doesn't mention it
  const parsed = await parseOk({ flagSpecMap, subcommandArgv: ["word"] });

  // Then it is undefined, so "not given" differs from `--no-askOnCommit`
  assertEquals(parsed.flags.askOnCommit, undefined);
  assertEquals("askOnCommit" in parsed.flags, false);
});

Deno.test("parseCommandArgv never gives an optional-value flag the next word", async () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When a separate word follows it, including a declared value or a boolean
  for (const nextWord of ["null", "foo", "true", "false", "-"]) {
    const parsed = await parseOk({
      flagSpecMap,
      subcommandArgv: ["--askOnCommit", nextWord],
    });

    // Then the flag is just switched on and the word stays positional
    assertEquals(parsed.flags.askOnCommit, true);
    assertEquals(parsed.argv, [nextWord]);
  }
});

Deno.test("parseCommandArgv keeps the last spelling of a repeated optional-value flag", async () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When it is written several times
  const valueLast = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit", "--no-askOnCommit", "--askOnCommit=null"],
  });
  const switchLast = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit=null", "--askOnCommit"],
  });

  // Then the last one written wins
  assertEquals(valueLast.flags.askOnCommit, "null");
  assertEquals(switchLast.flags.askOnCommit, true);
});

Deno.test("parseCommandArgv leaves the flags around an optional-value flag unchanged", async () => {
  // Given an optional-value flag beside a string and a boolean flag
  const flagSpecMap = askOnCommitFlags;

  // When a string flag directly precedes it, and a word follows
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--title", "--askOnCommit", "word", "--json"],
  });

  // Then the string flag reads empty, as before any flag, not the word
  assertEquals(parsed.flags.title, "");
  assertEquals(parsed.flags.askOnCommit, true);
  assertEquals(parsed.flags.json, true);
  assertEquals(parsed.argv, ["word"]);
});

Deno.test("parseCommandArgv refuses an undeclared attached value", async () => {
  // Given an optional-value flag declaring only `null`
  const flagSpecMap = askOnCommitFlags;

  for (const value of ["foo", "", "true", "NULL", "null=x"]) {
    // When another value is attached
    const outcome = await parseCommandArgv({
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
        issues: [{ message: "expected one of: null" }],
        allowedValues: ["null"],
      },
    });
  }
});

// maat's real case: a switch that also takes `=true`, `=false`, or `=null`.
const maatAskOnCommitFlags = {
  askOnCommit: { kind: "optional-value", choices: ["null"], booleans: true },
} as const satisfies Record<string, FlagSpec>;

Deno.test("parseCommandArgv reads maat's askOnCommit in all five spellings", async () => {
  // Given an optional-value flag with `choices: ["null"]` and `booleans: true`
  const flagSpecMap = maatAskOnCommitFlags;

  // When each spelling is parsed
  const read = async (spelling: string) => {
    const parsed = await parseOk({ flagSpecMap, subcommandArgv: [spelling] });
    return parsed.flags.askOnCommit;
  };

  // Then switches and boolean words become booleans, and `null` stays text
  assertEquals(await read("--askOnCommit"), true);
  assertEquals(await read("--no-askOnCommit"), false);
  assertEquals(await read("--askOnCommit=true"), true);
  assertEquals(await read("--askOnCommit=false"), false);
  assertEquals(await read("--askOnCommit=null"), "null");
});

Deno.test("FlagsOf types maat's askOnCommit as boolean or null-literal", async () => {
  // Given maat's flag declaration
  const flagSpecMap = maatAskOnCommitFlags;

  // When parsed
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit=false"],
  });

  // Then the type is exactly boolean | "null" | undefined: it fits that
  // union, it is wider than boolean, and an arbitrary string doesn't fit it
  type AskOnCommit = typeof parsed.flags.askOnCommit;
  const askOnCommit: boolean | "null" | undefined = parsed.flags.askOnCommit;
  // @ts-expect-error: the "null" literal is in the type, so boolean is too narrow
  const switchOnly: boolean | undefined = parsed.flags.askOnCommit;
  const arbitraryText: string = "other";
  // @ts-expect-error: a free string is not one of the declared choices
  const freeText: AskOnCommit = arbitraryText;
  assertEquals([askOnCommit, switchOnly, freeText], [false, false, "other"]);
});

Deno.test("parseCommandArgv lists the boolean spellings among the accepted values", async () => {
  // Given maat's flag declaration
  const flagSpecMap = maatAskOnCommitFlags;

  // When an undeclared value is attached
  const outcome = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit=maybe"],
  });

  // Then the one issue and the allowed set include true and false
  assertEquals(outcome, {
    ok: false,
    error: {
      kind: "invalid-flag-value",
      flagName: "askOnCommit",
      value: "maybe",
      issues: [{ message: "expected one of: true|false|null" }],
      allowedValues: ["true", "false", "null"],
    },
  });
});

Deno.test("parseCommandArgv accepts any attached string when no choices are declared", async () => {
  // Given an optional-value flag with no closed set
  const flagSpecMap = {
    label: { kind: "optional-value" },
  } as const satisfies Record<string, FlagSpec>;

  // When it is given arbitrary text, including `true`
  const text = await parseOk({ flagSpecMap, subcommandArgv: ["--label=v1.2"] });
  const trueText = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--label=true"],
  });

  // Then the text arrives as written, typed string, since booleans is off
  const label: boolean | string | undefined = text.flags.label;
  assertEquals(label, "v1.2");
  assertEquals(trueText.flags.label, "true");
});

Deno.test("parseCommandArgv reads booleans on a free-string optional-value flag", async () => {
  // Given an optional-value flag with booleans and no closed set
  const flagSpecMap = {
    label: { kind: "optional-value", booleans: true },
  } as const satisfies Record<string, FlagSpec>;

  // When it is given `false` and other text
  const falseWord = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--label=false"],
  });
  const text = await parseOk({ flagSpecMap, subcommandArgv: ["--label=nope"] });

  // Then `false` is the boolean and other text is kept
  assertEquals(falseWord.flags.label, false);
  assertEquals(text.flags.label, "nope");
});

Deno.test("parseCommandArgv refuses a value attached to the negated spelling", async () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When a value is attached to `--no-askOnCommit`
  const outcome = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--no-askOnCommit=null"],
  });

  // Then it is an unknown flag, not a quiet `--askOnCommit=null`
  assertEquals(outcome, {
    ok: false,
    error: { kind: "unknown-flag", flagToken: "--no-askOnCommit=null" },
  });
});

Deno.test("parseCommandArgv leaves optional-value spellings after `--` as words", async () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When its spellings follow `--`, even an undeclared value
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--", "--askOnCommit=foo", "--no-askOnCommit"],
  });

  // Then they are words and the flag is unset
  assertEquals(parsed.argv, ["--askOnCommit=foo", "--no-askOnCommit"]);
  assertEquals(parsed.flags.askOnCommit, undefined);
});

Deno.test("parseCommandArgv reports flag errors in the order they were typed", async () => {
  // Given an optional-value flag declaring only `null`
  const flagSpecMap = askOnCommitFlags;

  // When an unknown flag and an undeclared value come in either order
  const unknownFirst = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--bogus", "--askOnCommit=bad"],
  });
  const invalidFirst = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit=bad", "--bogus"],
  });

  // Then the error is whichever came first in argv
  assertEquals(unknownFirst, {
    ok: false,
    error: { kind: "unknown-flag", flagToken: "--bogus" },
  });
  assertEquals(invalidFirst, {
    ok: false,
    error: {
      kind: "invalid-flag-value",
      flagName: "askOnCommit",
      value: "bad",
      issues: [{ message: "expected one of: null" }],
      allowedValues: ["null"],
    },
  });
});

Deno.test("parseCommandArgv still refuses an unknown flag between optional-value spellings", async () => {
  // Given an optional-value flag
  const flagSpecMap = askOnCommitFlags;

  // When valid spellings surround an unknown flag
  const outcome = await parseCommandArgv({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit", "--bogus", "word", "--no-askOnCommit"],
  });

  // Then the unknown flag is named, as it would be without them
  assertEquals(outcome, {
    ok: false,
    error: { kind: "unknown-flag", flagToken: "--bogus" },
  });
});

Deno.test("parseCommandArgv refuses typed tokens that spell its internal keys", async () => {
  // Given an optional-value flag beside a string flag
  const flagSpecMap = askOnCommitFlags;

  for (const token of [
    "--clipc optional value=evil",
    "--clipc optional value",
    "--clipc refused flag=0",
    "--no-clipc optional value=evil",
  ]) {
    // When the reserved spelling is typed, next to an invalid value that
    // would otherwise own marker 0, and before a word
    const outcome = await parseCommandArgv({
      flagSpecMap,
      subcommandArgv: [token, "word", "--askOnCommit=bad"],
    });

    // Then it is an unknown flag named as typed: not dropped, not taking
    // the next word, and not passing for the later refusal
    assertEquals(outcome, {
      ok: false,
      error: { kind: "unknown-flag", flagToken: token },
    });
  }
});

Deno.test("parseCommandArgv reads an optional-value flag whose name starts with no-", async () => {
  // Given an optional-value flag named like a negation
  const flagSpecMap = {
    "no-verify": { kind: "optional-value", choices: ["hooks"] },
  } as const satisfies Record<string, FlagSpec>;

  // When it is written bare, with its value, and negated
  const bare = await parseOk({ flagSpecMap, subcommandArgv: ["--no-verify"] });
  const attached = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--no-verify=hooks"],
  });
  const negated = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--no-no-verify"],
  });

  // Then each reads under its own name, never as an unknown flag
  assertEquals(bare.flags["no-verify"], true);
  assertEquals(attached.flags["no-verify"], "hooks");
  assertEquals(negated.flags["no-verify"], false);
});

Deno.test("parseCommandArgv keeps a dotted optional-value name flat", async () => {
  // Given an optional-value flag whose name has a dot
  const flagSpecMap = {
    "cache.mode": { kind: "optional-value", choices: ["off"] },
  } as const satisfies Record<string, FlagSpec>;

  // When it is given its value
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--cache.mode=off"],
  });

  // Then the flags hold exactly that key, with no nested stray
  assertEquals(parsed.flags, { "cache.mode": "off" });
});

Deno.test("parseCommandArgv accepts each of several declared choices", async () => {
  // Given an optional-value flag with three declared choices
  const flagSpecMap = {
    color: { kind: "optional-value", choices: ["always", "never", "auto"] },
  } satisfies Record<string, FlagSpec>;

  for (const value of flagSpecMap.color.choices) {
    // When that value is attached
    const parsed = await parseOk({
      flagSpecMap,
      subcommandArgv: [`--color=${value}`],
    });

    // Then the flag carries exactly that value
    assertEquals(parsed.flags.color, value);
  }
});

Deno.test("FlagsOf types an optional-value flag as boolean or a declared value", async () => {
  // Given an optional-value flag declaring `null`
  const flagSpecMap = askOnCommitFlags;

  // When parsed
  const parsed = await parseOk({
    flagSpecMap,
    subcommandArgv: ["--askOnCommit"],
  });

  // Then the type admits exactly boolean, the literal, and undefined
  const askOnCommit: boolean | "null" | undefined = parsed.flags.askOnCommit;
  // @ts-expect-error: the declared literal is in the type, so this is too narrow
  const switchOnly: boolean | undefined = parsed.flags.askOnCommit;
  assertEquals([askOnCommit, switchOnly], [true, true]);
});
