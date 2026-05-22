import { assertEquals } from "@std/assert";
import { CliError } from "./errors.ts";

Deno.test("CliError constructs with the minimal required fields", () => {
  // Given the smallest legal init
  const error = new CliError({
    code: "dirty-tree",
    message: "working tree is not clean",
  });

  // Then the public fields carry the inputs and defaults
  assertEquals(error.code, "dirty-tree");
  assertEquals(error.message, "working tree is not clean");
  assertEquals(error.hint, undefined);
  assertEquals(error.severity, "error");
  assertEquals(error.subErrors, []);
  assertEquals(error.context, {});
  assertEquals(error instanceof Error, true);
});

Deno.test("CliError carries hint, severity, cause, subErrors, and context when supplied", () => {
  // Given a fully-populated init with every optional field
  const inner = new Error("underlying io failure");
  const subError = new CliError({
    code: "publish-failed",
    message: "pkg-a: jsr token expired",
    context: { package: "pkg-a", tag: "pkg-a@1.0.0" },
  });

  // When the parent error is constructed
  const error = new CliError({
    code: "release-partial-failure",
    message: "1 package failed to publish",
    hint: "rerun dv release --force after fixing the cause",
    severity: "error",
    cause: inner,
    subErrors: [subError],
    context: { totalAttempted: 3 },
  });

  // Then every field is preserved verbatim
  assertEquals(error.code, "release-partial-failure");
  assertEquals(error.hint, "rerun dv release --force after fixing the cause");
  assertEquals(error.severity, "error");
  assertEquals(error.cause, inner);
  assertEquals(error.subErrors.length, 1);
  assertEquals(error.subErrors[0]?.code, "publish-failed");
  assertEquals(error.context.totalAttempted, 3);
});

Deno.test("CliError.toJSON omits defaults and empty collections for terse wire output", () => {
  // Given a minimal CliError
  const error = new CliError({
    code: "dirty-tree",
    message: "working tree is not clean",
  });

  // When serialized
  const payload = error.toJSON();

  // Then only the required fields appear — no `severity: "error"`,
  // no empty subErrors, no empty context
  assertEquals(payload, {
    code: "dirty-tree",
    message: "working tree is not clean",
  });
});

Deno.test("CliError.toJSON includes hint and context when present", () => {
  // Given an error with a hint and context (default open shape)
  const error = new CliError({
    code: "plugin-not-executable",
    message: "plugin not executable",
    hint: "run chmod +x on the plugin file",
    context: { pluginPath: "./examples/plugins/deno/release" },
  });

  // When serialized
  const payload = error.toJSON();

  // Then the optional fields ride along
  assertEquals(payload.hint, "run chmod +x on the plugin file");
  assertEquals(payload.context, {
    pluginPath: "./examples/plugins/deno/release",
  });
});

Deno.test("CliError.toJSON recurses through subErrors", () => {
  // Given a nested error tree
  const error = new CliError({
    code: "release-partial-failure",
    message: "2 packages failed",
    subErrors: [
      new CliError({
        code: "publish-failed",
        message: "pkg-a: jsr token expired",
      }),
      new CliError({
        code: "publish-failed",
        message: "pkg-b: 403 forbidden",
      }),
    ],
  });

  // When serialized
  const payload = error.toJSON();

  // Then the sub-error tree round-trips, each carrying its own
  // terse default-omitting shape
  assertEquals(payload.subErrors?.length, 2);
  assertEquals(payload.subErrors?.[0], {
    code: "publish-failed",
    message: "pkg-a: jsr token expired",
  });
  assertEquals(payload.subErrors?.[1]?.code, "publish-failed");
});

Deno.test("CliError.toJSON emits non-default severity but never serializes `cause`", () => {
  // Given a warning-severity error with a JS-level cause
  const error = new CliError({
    code: "deprecated-option",
    message: "this option is deprecated",
    severity: "warning",
    cause: new Error("internal trace"),
  });

  // When serialized
  const payload = error.toJSON();

  // Then severity is preserved but `cause` is intentionally absent —
  // it's a JS Error instance, not a contract field
  assertEquals(payload.severity, "warning");
  assertEquals("cause" in payload, false);
});

Deno.test("CliError preserves the Error.cause linkage so JS stack chains work", () => {
  // Given an inner error wrapped by a CliError
  const inner = new Error("underlying ENOENT");
  const error = new CliError({
    code: "config-not-found",
    message: ".changelog/config.yaml is missing",
    cause: inner,
  });

  // When the cause is read back through the standard Error API
  // Then it's the same instance — useful for `--debug` rendering
  // later and for native console.error chaining
  assertEquals(error.cause, inner);
});

Deno.test("CliError's discriminated-union generic enforces code↔context pairing at the throw site", () => {
  // Given an app-side error union — `code` and per-code `context`
  // declared together so they can't drift
  type AppErrorShape =
    | { code: "dirty-tree" }
    | {
        code: "plugin-not-executable";
        context: { pluginPath: string; opName: string };
      }
    | {
        code: "release-partial-failure";
        context: { totalAttempted: number };
      };

  // When errors are constructed for each variant
  const dirtyTreeError = new CliError<AppErrorShape>({
    code: "dirty-tree",
    message: "working tree is not clean",
  });
  const pluginError = new CliError<AppErrorShape>({
    code: "plugin-not-executable",
    message: "plugin not executable",
    context: {
      pluginPath: "./examples/plugins/deno/release",
      opName: "release",
    },
  });

  // Then each carries the expected runtime context. The compile-
  // time check that pairs code↔context happens at the construction
  // site above — TS rejects `code: "dirty-tree"` with a `context`
  // field, or `code: "plugin-not-executable"` without one. Read-
  // site narrowing requires manual discrimination (TS can't link
  // `err.code` and `err.context` since they're separate readonly
  // fields), but that's a small price for the throw-time safety.
  assertEquals(dirtyTreeError.code, "dirty-tree");
  const pluginContext = pluginError.context as {
    pluginPath: string;
    opName: string;
  };
  assertEquals(pluginContext.pluginPath, "./examples/plugins/deno/release");
  assertEquals(pluginContext.opName, "release");
});

Deno.test("CliError defaults to the open shape when no generic is supplied (back-compat)", () => {
  // Given an error constructed without a generic argument — the
  // pattern existing throw sites use today
  const error = new CliError({
    code: "ad-hoc",
    message: "loose context shape",
    context: { whatever: "value", count: 7 },
  });

  // When the context is read
  // Then the default shape allows any string code with an open
  // record context — no compile-time narrowing, just runtime values
  assertEquals(error.context.whatever, "value");
  assertEquals(error.context.count, 7);
});
