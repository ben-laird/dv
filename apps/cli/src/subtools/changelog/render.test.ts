import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Record as DvRecord } from "../../domain/record.ts";
import { extractHeadline, renderReleaseSection } from "./render.ts";

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

Deno.test("extractHeadline strips a leading h1 so the bullet does not carry a stray `#`", () => {
  // Given a Record body that opens with a markdown h1 — the convention
  // that lets records lint cleanly as standalone documents (MD041)
  const body = "# Implement constraint cascading\n\nWhen a package bumps...\n";

  // When the headline is extracted
  const headline = extractHeadline(body);

  // Then the `# ` prefix is stripped and only the title text remains
  assertEquals(headline, "Implement constraint cascading");
});

Deno.test("extractHeadline falls back to the first non-empty line when the body has no h1", () => {
  // Given a body without a leading h1 (the pre-v1 convention)
  const body = "Patch the parser to handle UTF-8 BOM.\n\nDetails below.\n";

  // When the headline is extracted
  const headline = extractHeadline(body);

  // Then the first line is used as-is (with whitespace trimmed)
  assertEquals(headline, "Patch the parser to handle UTF-8 BOM.");
});

Deno.test("extractHeadline skips blank lines before the headline", () => {
  // Given a body that opens with blank lines (a quirk of editor
  // templates that leave a blank line above the user's prose)
  const body = "\n\n# Real headline\n\nbody...\n";

  // When the headline is extracted
  const headline = extractHeadline(body);

  // Then the blank lines are skipped and the h1 is found
  assertEquals(headline, "Real headline");
});

Deno.test("extractHeadline ignores non-h1 markdown headings (h2+) and falls back to first-line behavior", () => {
  // Given a body that leads with an h2 (uncommon but possible)
  const body = "## A subsection\n\nbody...\n";

  // When the headline is extracted
  const headline = extractHeadline(body);

  // Then the line is taken as-is, including its `##` — the renderer
  // only special-cases h1 because that's the convention records use
  // as a document title (per record-format.md)
  assertEquals(headline, "## A subsection");
});

Deno.test("renderReleaseSection lifts the bullet from a leading h1 when present", () => {
  // Given a Record whose body opens with `# Headline`
  const records: DvRecord[] = [
    {
      filename: "x.md",
      type: "feat",
      packages: ["core"],
      links: [],
      body: "# Implement device flow\n\nDetailed description.\n",
    },
  ];

  // When the section is rendered
  const section = renderReleaseSection({
    newVersion: "1.5.0",
    bump: "minor",
    records,
    dateString: "2026-05-22",
  });

  // Then the bullet is the h1 text — no stray `#`, no trailing detail
  assertStringIncludes(section, "- Implement device flow");
  assertEquals(section.includes("- # "), false);
  assertEquals(section.includes("Detailed description"), false);
});
