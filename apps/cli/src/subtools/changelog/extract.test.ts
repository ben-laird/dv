import { assertEquals } from "@std/assert";
import type { Record as DvRecord } from "../../domain/record.ts";
import { extractReleaseSection } from "./extract.ts";
import { renderReleaseSection } from "./render.ts";

function makeRecord(overrides: Partial<DvRecord>): DvRecord {
  return {
    filename: "x.md",
    type: "feat",
    packages: ["pkg"],
    body: "# A change",
    links: [],
    ...overrides,
  };
}

Deno.test("extractReleaseSection round-trips a rendered section", () => {
  // Given a CHANGELOG built by prepending two rendered sections
  const newer = renderReleaseSection({
    newVersion: "1.2.0",
    bump: "minor",
    records: [makeRecord({ body: "# Add the thing" })],
    dateString: "2026-06-07",
  });
  const older = renderReleaseSection({
    newVersion: "1.1.0",
    bump: "minor",
    records: [makeRecord({ body: "# Earlier thing" })],
    dateString: "2026-05-01",
  });
  const changelogText = `# Changelog\n\n${newer}\n${older}`;

  // When extracting the newer section
  const section = extractReleaseSection({ changelogText, version: "1.2.0" });

  // Then the heading is dropped and only that version's body is returned
  assertEquals(section, "### Added\n\n- Add the thing");
});

Deno.test("extractReleaseSection extracts the last (oldest) section up to EOF", () => {
  // Given a CHANGELOG whose target section is the final one
  const newer = renderReleaseSection({
    newVersion: "2.0.0",
    bump: "major",
    records: [makeRecord({ type: "feat!", body: "# Breaking" })],
    dateString: "2026-06-07",
  });
  const oldest = renderReleaseSection({
    newVersion: "1.0.0",
    bump: "minor",
    records: [makeRecord({ body: "# First" })],
    dateString: "2026-01-01",
  });
  const changelogText = `# Changelog\n\n${newer}\n${oldest}`;

  // When extracting the final section
  const section = extractReleaseSection({ changelogText, version: "1.0.0" });

  // Then it captures the body through EOF without bleeding into the newer one
  assertEquals(section, "### Added\n\n- First");
});

Deno.test("extractReleaseSection returns null for a missing version", () => {
  // Given a CHANGELOG without the requested version
  const changelogText =
    "# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- x\n";

  // When extracting a version that isn't present
  const section = extractReleaseSection({ changelogText, version: "9.9.9" });

  // Then null signals "no section"
  assertEquals(section, null);
});
