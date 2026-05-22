import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Record as DvRecord } from "../../domain/record.ts";
import { renderHistorySection } from "./render.ts";

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

Deno.test("renderHistorySection emits an h3 per Record with its body prose below the h1", () => {
  // Given a Record using the h1 convention (a markdown-valid headline
  // line followed by body prose)
  const records: DvRecord[] = [
    buildRecord({
      type: "feat",
      body: "# Add OAuth device flow\n\nClients without a browser can now\nauthenticate using the device grant.\n",
    }),
  ];

  // When the section is rendered
  const section = renderHistorySection({
    newVersion: "1.5.0",
    records,
    dateString: "2026-05-22",
  });

  // Then the section opens with the per-version h2, the entry is an
  // h3 with the headline (no leading `#`), and the body below the h1
  // is preserved verbatim. The headline text appears exactly once —
  // proving the original `# Add OAuth ...` h1 line was stripped, not
  // duplicated alongside the new `### Add OAuth ...` heading.
  assertStringIncludes(section, "## [1.5.0] - 2026-05-22");
  assertStringIncludes(section, "### Add OAuth device flow");
  assertStringIncludes(
    section,
    "Clients without a browser can now\nauthenticate using the device grant.",
  );
  const headlineMatches = [...section.matchAll(/Add OAuth device flow/g)];
  assertEquals(headlineMatches.length, 1);
});

Deno.test("renderHistorySection groups multiple Records under one version section", () => {
  // Given two Records in the same release
  const records: DvRecord[] = [
    buildRecord({
      type: "feat",
      body: "# Implement device flow\n\nLong prose A.\n",
    }),
    buildRecord({
      type: "fix",
      body: "# Patch the parser\n\nLong prose B.\n",
    }),
  ];

  // When the section is rendered
  const section = renderHistorySection({
    newVersion: "1.5.0",
    records,
    dateString: "2026-05-22",
  });

  // Then both h3 subsections appear under one h2, in input order
  // (Records aren't grouped by Change Type in HISTORY — that's a
  // CHANGELOG concern)
  const indexFirst = section.indexOf("### Implement device flow");
  const indexSecond = section.indexOf("### Patch the parser");
  assertEquals(indexFirst > 0, true);
  assertEquals(indexSecond > indexFirst, true);
  assertStringIncludes(section, "Long prose A.");
  assertStringIncludes(section, "Long prose B.");
});

Deno.test("renderHistorySection falls back to the first non-empty line as the h3 title for legacy bodies without an h1", () => {
  // Given a Record body that does NOT use the h1 convention (the
  // pre-v1 first-line-as-headline format)
  const records: DvRecord[] = [
    buildRecord({
      type: "feat",
      body: "Legacy headline as first line.\n\nSupporting prose.\n",
    }),
  ];

  // When the section is rendered
  const section = renderHistorySection({
    newVersion: "1.5.0",
    records,
    dateString: "2026-05-22",
  });

  // Then the first line becomes the h3 title and the remaining body
  // forms the entry content
  assertStringIncludes(section, "### Legacy headline as first line.");
  assertStringIncludes(section, "Supporting prose.");
});

Deno.test("renderHistorySection emits an empty-version section when no records are present", () => {
  // Given no Records (an edge case the caller should normally
  // short-circuit, but the renderer must handle defensively)
  const section = renderHistorySection({
    newVersion: "0.1.0",
    records: [],
    dateString: "2026-05-22",
  });

  // Then the heading exists alone, with no h3 subsections
  assertStringIncludes(section, "## [0.1.0] - 2026-05-22");
  assertEquals(section.includes("###"), false);
});

Deno.test("renderHistorySection handles a Record whose body is just the h1 line", () => {
  // Given a Record with a headline but no body prose below it (some
  // commits are genuinely one-liners)
  const records: DvRecord[] = [
    buildRecord({
      type: "fix",
      body: "# Fix a small typo\n",
    }),
  ];

  // When the section is rendered
  const section = renderHistorySection({
    newVersion: "1.0.1",
    records,
    dateString: "2026-05-22",
  });

  // Then the h3 appears alone — no stray blank trailing content from
  // attempts to render a non-existent body. Headline appears exactly
  // once (the original `# Fix...` h1 was stripped).
  assertStringIncludes(section, "### Fix a small typo");
  const headlineMatches = [...section.matchAll(/Fix a small typo/g)];
  assertEquals(headlineMatches.length, 1);
});

Deno.test("renderHistorySection treats breaking-flavor Records identically to non-breaking — narrative, not structured", () => {
  // Given a breaking Record (feat!)
  const records: DvRecord[] = [
    buildRecord({
      type: "feat!",
      body: "# Drop support for Node 16\n\nThe legacy-stream API has been removed.\n",
    }),
  ];

  // When the section is rendered
  const section = renderHistorySection({
    newVersion: "2.0.0",
    records,
    dateString: "2026-05-22",
  });

  // Then no **BREAKING** prefix or section-grouping appears — HISTORY
  // is narrative; the CHANGELOG renderer is where breaking changes
  // get visual emphasis
  assertEquals(section.includes("**BREAKING**"), false);
  assertEquals(section.includes("### Added"), false);
  assertEquals(section.includes("### Changed"), false);
  assertStringIncludes(section, "### Drop support for Node 16");
  assertStringIncludes(section, "The legacy-stream API has been removed.");
});
