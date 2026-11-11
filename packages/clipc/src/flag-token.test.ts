import { assertEquals } from "@std/assert";
import { isFlagToken } from "./flag-token.ts";

Deno.test("isFlagToken treats a lone `-` as a word", () => {
  // Given the bare dash, which by convention often names stdin
  const bareDash = "-";

  // When isFlagToken reads it
  const answer = isFlagToken(bareDash);

  // Then it is not a flag
  assertEquals(answer, false);
});

Deno.test("isFlagToken sees short, long and number-like switches", () => {
  // Given tokens written as switches
  const switches = ["-x", "--x", "-5", "--", "--title=-"];

  // When isFlagToken reads each
  const answers = switches.map(isFlagToken);

  // Then every one is a flag token
  assertEquals(answers, [true, true, true, true, true]);
});

Deno.test("isFlagToken answers false for plain words", () => {
  // Given words that do not start with `-`
  const words = ["add", "007", "a-b"];

  // When isFlagToken reads each
  const answers = words.map(isFlagToken);

  // Then none is a flag token
  assertEquals(answers, [false, false, false]);
});
