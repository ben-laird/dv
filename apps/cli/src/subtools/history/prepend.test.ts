import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildFreshHistory, prependHistorySection } from "./prepend.ts";

Deno.test("buildFreshHistory produces a HISTORY preamble followed by the new section", () => {
  // Given a freshly-rendered HISTORY release section
  const newSection = "## [0.1.0] - 2026-05-22\n\n### First feature\n\nProse.\n";

  // When the fresh HISTORY is built
  const builtHistory = buildFreshHistory(newSection);

  // Then it leads with the # History heading + preamble paragraph,
  // and the new section follows
  assertStringIncludes(builtHistory, "# History");
  assertStringIncludes(builtHistory, "Long-form release notes");
  assertStringIncludes(builtHistory, "## [0.1.0] - 2026-05-22");
  assertEquals(builtHistory.endsWith("\n"), true);
});

Deno.test("buildFreshHistory's preamble explicitly points readers at CHANGELOG.md for terse bullets", () => {
  // Given a freshly-rendered section
  const builtHistory = buildFreshHistory("## [0.1.0] - 2026-05-22\n");

  // When the resulting file is inspected
  // Then the preamble names CHANGELOG.md so a reader landing here
  // knows where the terse bullets live (and vice versa — CHANGELOG
  // can mention HISTORY when we add cross-references later)
  assertStringIncludes(builtHistory, "CHANGELOG.md");
});

Deno.test("prependHistorySection inserts above the first existing version section", () => {
  // Given an existing HISTORY with one prior release
  const existingText = `# History

Long-form release notes for this Package.

## [1.4.2] - 2026-04-01

### Old fix

Prose for the old fix.
`;
  const newSection =
    "## [1.5.0] - 2026-05-22\n\n### New feature\n\nProse for the new feature.\n";

  // When the section is prepended
  const updated = prependHistorySection({ existingText, newSection });

  // Then the new heading appears before the old heading
  const newIndex = updated.indexOf("## [1.5.0]");
  const oldIndex = updated.indexOf("## [1.4.2]");
  assertEquals(newIndex < oldIndex, true);
  assertStringIncludes(updated, "Prose for the old fix.");
  assertStringIncludes(updated, "Prose for the new feature.");
});

Deno.test("prependHistorySection inserts below an Unreleased section but above real version sections", () => {
  // Given a HISTORY with an Unreleased block above a versioned section
  const existingText = `# History

## [Unreleased]

## [1.4.2] - 2026-04-01

### Old fix
`;
  const newSection = "## [1.5.0] - 2026-05-22\n\n### New feature\n";

  // When the section is prepended
  const updated = prependHistorySection({ existingText, newSection });

  // Then the new release lands above the existing release but below
  // [Unreleased]
  const unreleasedIndex = updated.indexOf("## [Unreleased]");
  const newIndex = updated.indexOf("## [1.5.0]");
  const oldIndex = updated.indexOf("## [1.4.2]");
  assertEquals(unreleasedIndex < newIndex, true);
  assertEquals(newIndex < oldIndex, true);
});

Deno.test("prependHistorySection appends after the preamble when no version sections exist", () => {
  // Given a HISTORY with only a preamble (no version sections yet —
  // typically because no `dv version` has run since HISTORY was
  // enabled)
  const existingText = `# History

Empty so far.
`;
  const newSection = "## [0.1.0] - 2026-05-22\n\n### First\n\nProse.\n";

  // When the section is prepended
  const updated = prependHistorySection({ existingText, newSection });

  // Then the preamble is preserved and the section appears after it
  assertStringIncludes(updated, "Empty so far.");
  assertStringIncludes(updated, "## [0.1.0] - 2026-05-22");
  const preambleIndex = updated.indexOf("Empty so far.");
  const versionIndex = updated.indexOf("## [0.1.0]");
  assertEquals(preambleIndex < versionIndex, true);
});
