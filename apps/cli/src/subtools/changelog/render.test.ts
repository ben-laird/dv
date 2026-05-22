import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Record as DvRecord } from "../../domain/record.ts";
import { renderReleaseSection } from "./render.ts";

function buildRecord(args: {
  type: DvRecord["type"];
  body: string;
  links?: string[];
}): DvRecord {
  return {
    filename: "x.md",
    type: args.type,
    packages: ["core"],
    links: args.links ?? [],
    body: args.body,
  };
}

Deno.test("renderReleaseSection groups feat under Added and fix under Fixed", () => {
  // Given two records: one feat and one fix
  const records: DvRecord[] = [
    buildRecord({ type: "feat", body: "Add OAuth device flow." }),
    buildRecord({ type: "fix", body: "Handle UTF-8 BOM in config." }),
  ];

  // When rendered
  const section = renderReleaseSection({
    newVersion: "1.5.0",
    bump: "minor",
    records,
    dateString: "2026-05-22",
  });

  // Then the section starts with the dated heading and uses the
  // mapped Keep a Changelog sub-sections
  assertStringIncludes(section, "## [1.5.0] - 2026-05-22");
  assertStringIncludes(section, "### Added\n\n- Add OAuth device flow.");
  assertStringIncludes(section, "### Fixed\n\n- Handle UTF-8 BOM in config.");
});

Deno.test("renderReleaseSection places breaking records under Changed with a **BREAKING** prefix", () => {
  // Given a breaking record (feat!) and a non-breaking feat
  const records: DvRecord[] = [
    buildRecord({ type: "feat!", body: "Drop support for Node 16." }),
    buildRecord({ type: "feat", body: "Add device-flow login." }),
  ];

  // When rendered
  const section = renderReleaseSection({
    newVersion: "2.0.0",
    bump: "major",
    records,
    dateString: "2026-05-22",
  });

  // Then breaking lands in Changed with the prefix; the regular feat
  // stays in Added
  assertStringIncludes(
    section,
    "### Changed\n\n- **BREAKING** Drop support for Node 16.",
  );
  assertStringIncludes(section, "### Added\n\n- Add device-flow login.");
});

Deno.test("renderReleaseSection uses the first body line as the bullet headline", () => {
  // Given a multi-paragraph body — only the first line becomes the bullet
  const records: DvRecord[] = [
    buildRecord({
      type: "feat",
      body: "Add OAuth 2.0 device flow support.\n\nClients without a browser can now authenticate.",
    }),
  ];

  // When rendered
  const section = renderReleaseSection({
    newVersion: "1.5.0",
    bump: "minor",
    records,
    dateString: "2026-05-22",
  });

  // Then the bullet is the first line and the trailing paragraph is
  // intentionally not rendered (v1 keeps bullets terse)
  assertStringIncludes(section, "- Add OAuth 2.0 device flow support.");
  assertEquals(
    section.includes("Clients without a browser"),
    false,
    "subsequent paragraphs are not rendered in v1",
  );
});

Deno.test("renderReleaseSection appends links when a Record carries them", () => {
  // Given a record with two link URLs
  const records: DvRecord[] = [
    buildRecord({
      type: "fix",
      body: "Patch the parser.",
      links: ["https://example.com/pr/42", "https://example.com/issue/7"],
    }),
  ];

  // When rendered
  const section = renderReleaseSection({
    newVersion: "1.4.3",
    bump: "patch",
    records,
    dateString: "2026-05-22",
  });

  // Then both links surface in the bullet
  assertStringIncludes(section, "https://example.com/pr/42");
  assertStringIncludes(section, "https://example.com/issue/7");
});

Deno.test("renderReleaseSection omits Keep a Changelog sub-sections that have no Records", () => {
  // Given only feat records (no fixes, no breakings)
  const records: DvRecord[] = [
    buildRecord({ type: "feat", body: "Add X." }),
    buildRecord({ type: "feat", body: "Add Y." }),
  ];

  // When rendered
  const section = renderReleaseSection({
    newVersion: "1.5.0",
    bump: "minor",
    records,
    dateString: "2026-05-22",
  });

  // Then only ### Added appears — empty sub-sections are not emitted
  assertStringIncludes(section, "### Added");
  assertEquals(section.includes("### Fixed"), false);
  assertEquals(section.includes("### Changed"), false);
});
