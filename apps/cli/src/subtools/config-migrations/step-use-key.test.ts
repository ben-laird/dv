import { assertEquals, assertStringIncludes } from "@std/assert";
import { useKeyStep } from "./step-use-key.ts";

// Tests for the use-key discriminated migration step. Pure text
// in / text out — no fixtures, no filesystem. The step is the
// load-bearing piece of `dv migrate config` for the v1 release;
// each branch (the three legacy locations × path vs builtin
// inference) gets its own case so a future refactor can't quietly
// regress a path.

Deno.test("useKeyStep rewrites discovery.plugins[].use string into the path-tagged form", () => {
  // Given a config with the legacy path-shaped string form
  const before = `discovery:
  plugins:
    - match: "apps/*"
      use: ./examples/plugins/deno
`;

  // When the step applies
  const result = useKeyStep.apply({ text: before });

  // Then the rewritten text contains the tagged shape and the
  // change list names the location
  assertStringIncludes(
    result.rewrittenText,
    "use:\n        path: ./examples/plugins/deno",
  );
  assertEquals(result.changes.length, 1);
  assertEquals(result.changes[0]?.path, "discovery.plugins[0].use");
  assertEquals(result.changes[0]?.before, "./examples/plugins/deno");
  assertEquals(result.changes[0]?.kind, "path");
  assertEquals(result.changes[0]?.value, "./examples/plugins/deno");
});

Deno.test("useKeyStep infers builtin: for bare names (no path-like prefix)", () => {
  // Given a config with a bare-name string (the legacy "builtin
  // lookup" form)
  const before = `discovery:
  plugins:
    - match: "crates/*"
      use: cargo
`;

  // When the step applies
  const result = useKeyStep.apply({ text: before });

  // Then the inference produced `builtin:` — preserving the
  // legacy resolver's exact shape heuristic so the migrated
  // config behaves identically (the builtin arm errors in v1,
  // same as the legacy parser did for the same input)
  assertStringIncludes(result.rewrittenText, "use:\n        builtin: cargo");
  assertEquals(result.changes[0]?.kind, "builtin");
});

Deno.test("useKeyStep rewrites every plugin assignment in a multi-plugin discovery block", () => {
  // Given multiple legacy entries
  const before = `discovery:
  plugins:
    - match: "apps/*"
      use: ./examples/plugins/deno
    - match: "crates/*"
      use: cargo
    - match: "tools/*"
      use: /usr/local/bin/my-plugin
`;

  // When the step applies
  const result = useKeyStep.apply({ text: before });

  // Then each entry got its own change record with the per-entry
  // breadcrumb path
  assertEquals(result.changes.length, 3);
  assertEquals(result.changes[0]?.path, "discovery.plugins[0].use");
  assertEquals(result.changes[0]?.kind, "path");
  assertEquals(result.changes[1]?.path, "discovery.plugins[1].use");
  assertEquals(result.changes[1]?.kind, "builtin");
  assertEquals(result.changes[2]?.path, "discovery.plugins[2].use");
  assertEquals(result.changes[2]?.kind, "path");
});

Deno.test("useKeyStep rewrites publishing.plugin too", () => {
  // Given a config with the legacy form at publishing.plugin
  const before = `publishing:
  plugin: ./scripts/release-handler
`;

  // When the step applies
  const result = useKeyStep.apply({ text: before });

  // Then publishing.plugin gets the same treatment as
  // discovery.plugins[].use
  assertStringIncludes(
    result.rewrittenText,
    "plugin:\n    path: ./scripts/release-handler",
  );
  assertEquals(result.changes.length, 1);
  assertEquals(result.changes[0]?.path, "publishing.plugin");
});

Deno.test("useKeyStep rewrites overrides[].plugin-use too", () => {
  // Given an overrides entry with the legacy plugin-use form
  const before = `overrides:
  - match: "packages/core"
    plugin-use: ./scripts/special
`;

  // When the step applies
  const result = useKeyStep.apply({ text: before });

  // Then plugin-use inside overrides is recognized and rewritten,
  // with the per-entry breadcrumb pointing at the right index
  assertStringIncludes(
    result.rewrittenText,
    "plugin-use:\n      path: ./scripts/special",
  );
  assertEquals(result.changes.length, 1);
  assertEquals(result.changes[0]?.path, "overrides[0].plugin-use");
});

Deno.test("useKeyStep is a no-op on configs already in the tagged form (idempotence)", () => {
  // Given a config that uses the new shape end-to-end
  const before = `discovery:
  plugins:
    - match: "apps/*"
      use:
        path: ./examples/plugins/deno
publishing:
  plugin:
    builtin: jsr
`;

  // When the step applies
  const result = useKeyStep.apply({ text: before });

  // Then nothing changes — the input is byte-equal to the output
  // and no change records are produced. Re-running migrations on
  // an already-current config has to be safe.
  assertEquals(result.rewrittenText, before);
  assertEquals(result.changes.length, 0);
});

Deno.test("useKeyStep preserves comments and surrounding whitespace verbatim", () => {
  // Given a config peppered with comments — the kind of file
  // `dv init` scaffolds and that users hand-edit
  const before = `# dv configuration for the rocket package suite.
#
# We use the deno plugin because everything is on JSR.

discovery:
  plugins:
    # apps/cli is the only user-facing tool.
    - match: "apps/*"
      use: ./examples/plugins/deno
`;

  // When the step applies
  const result = useKeyStep.apply({ text: before });

  // Then both header comments and the inline comment survive
  // the rewrite — they're how the user explains intent to their
  // future self
  assertStringIncludes(
    result.rewrittenText,
    "# dv configuration for the rocket package suite.",
  );
  assertStringIncludes(
    result.rewrittenText,
    "# We use the deno plugin because everything is on JSR.",
  );
  assertStringIncludes(
    result.rewrittenText,
    "# apps/cli is the only user-facing tool.",
  );
  // And the actual rewrite happened
  assertStringIncludes(
    result.rewrittenText,
    "use:\n        path: ./examples/plugins/deno",
  );
});
