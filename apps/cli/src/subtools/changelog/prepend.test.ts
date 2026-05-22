import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildFreshChangelog, prependChangelogSection } from "./prepend.ts";

Deno.test("buildFreshChangelog produces a Keep a Changelog preamble followed by the new section", () => {
  // Given a freshly-rendered release section
  const newSection =
    "## [0.1.0] - 2026-05-22\n\n### Added\n\n- First feature.\n";

  // When the fresh CHANGELOG is built
  const builtChangelog = buildFreshChangelog(newSection);

  // Then it leads with the # Changelog heading + KaC preamble and the
  // new section follows
  assertStringIncludes(builtChangelog, "# Changelog");
  assertStringIncludes(builtChangelog, "Keep a Changelog");
  assertStringIncludes(builtChangelog, "## [0.1.0] - 2026-05-22");
  assertEquals(builtChangelog.endsWith("\n"), true);
});

Deno.test("prependChangelogSection inserts above the first existing version section", () => {
  // Given an existing CHANGELOG with one prior release
  const existingText = `# Changelog

All notable changes documented here.

## [1.4.2] - 2026-04-01

### Fixed

- Old fix.
`;
  const newSection = "## [1.5.0] - 2026-05-22\n\n### Added\n\n- New feature.\n";

  // When the section is prepended
  const updated = prependChangelogSection({ existingText, newSection });

  // Then the new heading appears before the old heading
  const newIndex = updated.indexOf("## [1.5.0]");
  const oldIndex = updated.indexOf("## [1.4.2]");
  assertEquals(newIndex < oldIndex, true);
  assertStringIncludes(updated, "All notable changes documented here.");
  assertStringIncludes(updated, "Old fix.");
});

Deno.test("prependChangelogSection inserts below an Unreleased section but above real version sections", () => {
  // Given a CHANGELOG with an Unreleased block above a versioned section
  const existingText = `# Changelog

## [Unreleased]

## [1.4.2] - 2026-04-01

### Fixed

- Old fix.
`;
  const newSection = "## [1.5.0] - 2026-05-22\n\n### Added\n\n- New feature.\n";

  // When the section is prepended
  const updated = prependChangelogSection({ existingText, newSection });

  // Then the new release lands above the existing release but below
  // [Unreleased]
  const unreleasedIndex = updated.indexOf("## [Unreleased]");
  const newIndex = updated.indexOf("## [1.5.0]");
  const oldIndex = updated.indexOf("## [1.4.2]");
  assertEquals(unreleasedIndex < newIndex, true);
  assertEquals(newIndex < oldIndex, true);
});

Deno.test("prependChangelogSection appends after the preamble when no version sections exist", () => {
  // Given a CHANGELOG with only a preamble (no version sections yet)
  const existingText = `# Changelog

A new repo with no release history yet.
`;
  const newSection = "## [0.1.0] - 2026-05-22\n\n### Added\n\n- First.\n";

  // When the section is prepended
  const updated = prependChangelogSection({ existingText, newSection });

  // Then the preamble is preserved and the section appears after it
  assertStringIncludes(updated, "A new repo with no release history yet.");
  assertStringIncludes(updated, "## [0.1.0] - 2026-05-22");
  const preambleIndex = updated.indexOf("no release history");
  const versionIndex = updated.indexOf("## [0.1.0]");
  assertEquals(preambleIndex < versionIndex, true);
});
