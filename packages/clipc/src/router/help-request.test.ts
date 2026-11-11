import { assertEquals } from "@std/assert";
import { requestsHelp } from "./help-request.ts";

Deno.test("requestsHelp sees --help and -h among the switches", () => {
  // Given argv carrying a help token before any `--`
  const longForm = ["--json", "--help", "word"];
  const shortForm = ["word", "-h"];

  // When requestsHelp reads each
  const longAnswer = requestsHelp(longForm);
  const shortAnswer = requestsHelp(shortForm);

  // Then both ask for help
  assertEquals(longAnswer, true);
  assertEquals(shortAnswer, true);
});

Deno.test("requestsHelp treats --help and -h after `--` as words", () => {
  // Given argv whose only help tokens follow `--`
  const argvWithWords = ["word", "--", "--help", "-h"];

  // When requestsHelp reads it
  const answer = requestsHelp(argvWithWords);

  // Then it does not ask for help
  assertEquals(answer, false);
});

Deno.test("requestsHelp answers false for argv with no help token", () => {
  // Given argv with switches and words but no help token
  const argvWithoutHelp = ["--json", "word"];

  // When requestsHelp reads it
  const answer = requestsHelp(argvWithoutHelp);

  // Then it does not ask for help
  assertEquals(answer, false);
});

Deno.test("requestsHelp reads past a bare `-`, which is a word", () => {
  // Given a bare `-` before a help token, and a bare `-` alone
  const dashThenHelp = ["-", "--help"];
  const dashAlone = ["-"];

  // When requestsHelp reads each
  const helpAnswer = requestsHelp(dashThenHelp);
  const dashAnswer = requestsHelp(dashAlone);

  // Then `-` neither asks for help nor hides the help token after it
  assertEquals(helpAnswer, true);
  assertEquals(dashAnswer, false);
});
