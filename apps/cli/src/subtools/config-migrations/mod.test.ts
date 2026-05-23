import { assertEquals } from "@std/assert";
import { runConfigMigrations } from "./mod.ts";

// Tests for the runner. The per-step logic is covered by each
// step's own `.test.ts`; here we cover what the *runner*
// guarantees: idempotence, ordering, the "no changes when no
// step matched" shape.

Deno.test("runConfigMigrations returns the input unchanged when no step matched", () => {
  // Given a config in the current shape — nothing legacy for any
  // registered step to recognize
  const text = `discovery:
  plugins:
    - match: "apps/*"
      use:
        path: ./examples/plugins/deno
`;

  // When the runner walks every step
  const result = runConfigMigrations({ originalText: text });

  // Then the text comes back byte-equal and the step-results
  // array is empty (the "already migrated" canonical signal)
  assertEquals(result.rewrittenText, text);
  assertEquals(result.stepResults, []);
});

Deno.test("runConfigMigrations rolls all applicable steps' changes into the output", () => {
  // Given a config with the use-key step's legacy shape (the
  // only step in v1; this test shape generalizes to multi-step
  // scenarios once a second step lands)
  const text = `discovery:
  plugins:
    - match: "apps/*"
      use: ./examples/plugins/deno
`;

  // When the runner runs
  const result = runConfigMigrations({ originalText: text });

  // Then the step's changes flow through as a per-step record;
  // every step that contributed >=1 change shows up.
  assertEquals(result.stepResults.length, 1);
  assertEquals(result.stepResults[0]?.stepId, "use-key-discriminated");
  assertEquals(result.stepResults[0]?.changes.length, 1);
  // And the final text is what that step produced
  assertEquals(
    result.rewrittenText.includes(
      "use:\n        path: ./examples/plugins/deno",
    ),
    true,
  );
});

Deno.test("runConfigMigrations is idempotent: a second run on the rewritten text is a no-op", () => {
  // Given a legacy config
  const original = `discovery:
  plugins:
    - match: "apps/*"
      use: ./plugin
`;

  // When we run the migration once, then run it again on the
  // output of the first run
  const firstPass = runConfigMigrations({ originalText: original });
  const secondPass = runConfigMigrations({
    originalText: firstPass.rewrittenText,
  });

  // Then the second pass produces zero changes (the output of
  // the first pass is already in the current shape). This is
  // the canonical "safe to re-run" property — important because
  // users might run `dv migrate config` defensively without
  // remembering whether they've run it before.
  assertEquals(secondPass.stepResults, []);
  assertEquals(secondPass.rewrittenText, firstPass.rewrittenText);
});
