import { assertEquals, assertThrows } from "@std/assert";
import { PosixTokenizeError, posixTokenize } from "./posix-tokenize.ts";

// Direct tests for the shared POSIX tokenizer. Two consumers
// (parse-editor-command + the `run:` plugin arm) both rely on
// the same tokenizer; testing it here keeps the regression
// surface tight and lets each consumer's own tests stay focused
// on their domain-specific error mapping.

Deno.test("posixTokenize splits unquoted words on whitespace", () => {
  assertEquals(posixTokenize("vim --wait /tmp/edit.md"), [
    "vim",
    "--wait",
    "/tmp/edit.md",
  ]);
});

Deno.test("posixTokenize preserves spaces inside double-quoted spans", () => {
  assertEquals(posixTokenize('code --wait "/path with spaces/file.md"'), [
    "code",
    "--wait",
    "/path with spaces/file.md",
  ]);
});

Deno.test("posixTokenize preserves spaces inside single-quoted spans (literal, no escapes)", () => {
  assertEquals(posixTokenize("vim -c 'set ft=markdown' -"), [
    "vim",
    "-c",
    "set ft=markdown",
    "-",
  ]);
});

Deno.test("posixTokenize honors backslash escapes outside quotes", () => {
  assertEquals(posixTokenize("vim /tmp/file\\ with\\ spaces"), [
    "vim",
    "/tmp/file with spaces",
  ]);
});

Deno.test('posixTokenize escapes " and \\ inside double quotes; treats other escapes as literal', () => {
  assertEquals(posixTokenize('echo "she said \\"hi\\""'), [
    "echo",
    'she said "hi"',
  ]);
  // A backslash before a non-special character inside double
  // quotes is kept verbatim (both the backslash and the char) —
  // matches `bash` behavior.
  assertEquals(posixTokenize('echo "literal \\n"'), ["echo", "literal \\n"]);
});

Deno.test("posixTokenize handles a typical `run:` plugin invocation", () => {
  // The shape the user wants: `deno run` with several allow-flags
  // and a JSR specifier. This is the load-bearing case for the
  // `run:` arm.
  assertEquals(posixTokenize("deno run -A jsr:@sekhmet/some-plugin"), [
    "deno",
    "run",
    "-A",
    "jsr:@sekhmet/some-plugin",
  ]);
});

Deno.test("posixTokenize throws 'empty' on empty input", () => {
  const caughtError = assertThrows(() => posixTokenize(""), PosixTokenizeError);
  assertEquals(caughtError.kind, "empty");
});

Deno.test("posixTokenize throws 'empty' on whitespace-only input", () => {
  const caughtError = assertThrows(
    () => posixTokenize("   \t\n  "),
    PosixTokenizeError,
  );
  assertEquals(caughtError.kind, "empty");
});

Deno.test("posixTokenize throws 'unterminated-single-quote' on an unclosed single quote", () => {
  const caughtError = assertThrows(
    () => posixTokenize("vim 'unclosed"),
    PosixTokenizeError,
  );
  assertEquals(caughtError.kind, "unterminated-single-quote");
});

Deno.test("posixTokenize throws 'unterminated-double-quote' on an unclosed double quote", () => {
  const caughtError = assertThrows(
    () => posixTokenize('vim "unclosed'),
    PosixTokenizeError,
  );
  assertEquals(caughtError.kind, "unterminated-double-quote");
});

Deno.test("posixTokenize throws 'trailing-backslash' on a backslash with nothing to escape", () => {
  const caughtError = assertThrows(
    () => posixTokenize("vim \\"),
    PosixTokenizeError,
  );
  assertEquals(caughtError.kind, "trailing-backslash");
});
