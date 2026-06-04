import { assertEquals, assertStringIncludes } from "@std/assert";
import { CliError } from "./errors.ts";
import { renderCliError } from "./render-cli-error.ts";

Deno.test("renderCliError human mode emits error[code]: message on the first line", () => {
  // Given a minimal CliError
  const err = new CliError({
    code: "dirty-tree",
    message: "working tree is not clean",
  });

  // When rendered in human mode
  const output = renderCliError({ err, mode: "human", colorEnabled: false });

  // Then the first line carries `error[code]: message`. The binary
  // prefix (e.g. `dv `) is the consumer's job — keeping it
  // consumer-defined lets other CLIs use the same renderer.
  assertStringIncludes(output, "error[dirty-tree]: working tree is not clean");
});

Deno.test("renderCliError human mode includes the hint line when present", () => {
  // Given a CliError carrying a hint
  const err = new CliError({
    code: "dirty-tree",
    message: "working tree is not clean",
    hint: "commit or stash before re-running",
  });

  // When rendered in human mode
  const output = renderCliError({ err, mode: "human", colorEnabled: false });

  // Then both the headline and the hint line appear, indented
  assertStringIncludes(output, "error[dirty-tree]");
  assertStringIncludes(output, "hint: commit or stash before re-running");
});

Deno.test("renderCliError human mode renders sub-errors with ✗ markers and context summaries", () => {
  // Given an aggregated CliError tree
  const err = new CliError({
    code: "release-partial-failure",
    message: "2 packages failed to publish",
    subErrors: [
      new CliError({
        code: "publish-failed",
        message: "jsr token expired",
        context: { package: "pkg-a", tag: "pkg-a@1.0.0" },
      }),
      new CliError({
        code: "publish-failed",
        message: "403 forbidden",
        context: { package: "pkg-b", tag: "pkg-b@0.5.0" },
      }),
    ],
  });

  // When rendered in human mode
  const output = renderCliError({ err, mode: "human", colorEnabled: false });

  // Then each sub-error appears with a ✗ marker and the most useful
  // context keys ride along on the same line
  assertStringIncludes(output, "✗ jsr token expired");
  assertStringIncludes(output, "package: pkg-a");
  assertStringIncludes(output, "tag: pkg-a@1.0.0");
  assertStringIncludes(output, "✗ 403 forbidden");
  assertStringIncludes(output, "package: pkg-b");
});

Deno.test("renderCliError human mode honors colorEnabled: false (no ANSI escapes)", () => {
  // Given any CliError
  const err = new CliError({
    code: "plugin-not-executable",
    message: "plugin not executable",
    hint: "run chmod +x on the plugin file",
  });

  // When rendered with colors off
  const output = renderCliError({ err, mode: "human", colorEnabled: false });

  // Then no ANSI escape sequence appears in the output — NO_COLOR
  // and --no-color need this to work
  assertEquals(output.includes("\x1b["), false);
});

Deno.test("renderCliError human mode honors colorEnabled: true (ANSI escapes for bold + dim)", () => {
  // Given a CliError
  const err = new CliError({
    code: "dirty-tree",
    message: "working tree is not clean",
  });

  // When rendered with colors on
  const output = renderCliError({ err, mode: "human", colorEnabled: true });

  // Then the bold (1m / 22m) and dim (2m) escape sequences appear,
  // matching the styler in the renderer
  assertStringIncludes(output, "\x1b[1m");
  assertStringIncludes(output, "\x1b[22m");
  assertStringIncludes(output, "\x1b[2m");
});

Deno.test("renderCliError JSON mode emits a `{ schema, error }` envelope matching the v1 contract", () => {
  // Given a fully-populated CliError
  const err = new CliError({
    code: "release-partial-failure",
    message: "1 package failed to publish",
    hint: "rerun dv release --force after fixing the cause",
    context: { totalAttempted: 3 },
    subErrors: [
      new CliError({
        code: "publish-failed",
        message: "pkg-a: jsr token expired",
        context: { package: "pkg-a", tag: "pkg-a@1.0.0" },
      }),
    ],
  });

  // When rendered in JSON mode
  const output = renderCliError({ err, mode: "json", colorEnabled: false });
  const parsed = JSON.parse(output);

  // Then the wire shape matches specs/schemas/cli-error.json — top-
  // level { schema, error }, with the error tree itself flat
  // (code/message/hint/context at top level, subErrors nested)
  assertEquals(parsed.schema, "urn:dv:schema:v1:cli-error");
  assertEquals(parsed.error.code, "release-partial-failure");
  assertEquals(parsed.error.message, "1 package failed to publish");
  assertEquals(
    parsed.error.hint,
    "rerun dv release --force after fixing the cause",
  );
  assertEquals(parsed.error.context, { totalAttempted: 3 });
  assertEquals(parsed.error.subErrors?.length, 1);
  assertEquals(parsed.error.subErrors[0]?.code, "publish-failed");
});

Deno.test("renderCliError JSON mode ignores colorEnabled (no ANSI in JSON)", () => {
  // Given a CliError and colorEnabled: true
  const err = new CliError({
    code: "dirty-tree",
    message: "working tree is not clean",
  });

  // When rendered in JSON mode
  const output = renderCliError({ err, mode: "json", colorEnabled: true });

  // Then no ANSI escape leaks into the JSON output — color is a
  // human-mode concern only
  assertEquals(output.includes("\x1b["), false);
  // And the output parses cleanly as JSON
  const parsed = JSON.parse(output);
  assertEquals(parsed.error.code, "dirty-tree");
});

Deno.test("renderCliError caps sub-error recursion at depth 5 to avoid runaway", () => {
  // Given a pathologically deep CliError chain (10 levels)
  let currentError = new CliError({
    code: "leaf",
    message: "leaf error",
  });
  for (let depth = 0; depth < 10; depth++) {
    currentError = new CliError({
      code: `level-${depth}`,
      message: `nesting level ${depth}`,
      subErrors: [currentError],
    });
  }

  // When rendered in human mode
  const output = renderCliError({
    err: currentError,
    mode: "human",
    colorEnabled: false,
  });

  // Then sub-error rendering halts somewhere before the leaf —
  // specifically at the 5-deep cap. The leaf message must not appear
  // in human output, but the cap doesn't prevent the JSON path from
  // serializing the full tree (toJSON has no cap; it's a contract).
  assertEquals(output.includes("leaf error"), false);
  // JSON path is uncapped (the wire contract carries everything).
  const jsonOutput = renderCliError({
    err: currentError,
    mode: "json",
    colorEnabled: false,
  });
  assertStringIncludes(jsonOutput, "leaf error");
});
