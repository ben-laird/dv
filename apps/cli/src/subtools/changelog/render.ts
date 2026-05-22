import type { Bump } from "../../domain/bump.ts";
import type { Record as DvRecord } from "../../domain/record.ts";

// Renders one Keep a Changelog release section from the set of Records
// that fed a Package's Bump. Pure: no IO, no current date discovery
// (the caller passes `dateString` so tests are deterministic).
//
// Mapping from dv's ChangeType vocabulary to KaC sections:
//   feat        → ### Added
//   fix         → ### Fixed
//   feat!, fix! → ### Changed, with each line prefixed `**BREAKING**`
//
// KaC has no breaking-changes section, so the bold prefix preserves
// discoverability without inventing a section the format doesn't have.
// `feat!` is editorially closer to Changed than Added — the package
// previously had some surface that the change broke. Treating both
// breaking flavors uniformly keeps the renderer simple.

export interface RenderReleaseSectionArgs {
  newVersion: string;
  bump: Bump;
  records: DvRecord[];
  dateString: string;
}

export function renderReleaseSection(args: RenderReleaseSectionArgs): string {
  const heading = `## [${args.newVersion}] - ${args.dateString}`;
  const groupedLines = groupRecordsByKacSection(args.records);
  const sectionBlocks: string[] = [];
  for (const sectionTitle of KAC_SECTION_ORDER) {
    const linesForSection = groupedLines.get(sectionTitle);
    if (!linesForSection || linesForSection.length === 0) continue;
    sectionBlocks.push(`### ${sectionTitle}\n\n${linesForSection.join("\n")}`);
  }
  return `${heading}\n\n${sectionBlocks.join("\n\n")}\n`;
}

const KAC_SECTION_ORDER = ["Added", "Changed", "Fixed"] as const;

type KacSectionTitle = (typeof KAC_SECTION_ORDER)[number];

function groupRecordsByKacSection(
  records: DvRecord[],
): Map<KacSectionTitle, string[]> {
  const grouped = new Map<KacSectionTitle, string[]>();
  for (const record of records) {
    const sectionTitle = sectionTitleFor(record);
    const bulletLine = formatBulletLine({ record, sectionTitle });
    const existing = grouped.get(sectionTitle) ?? [];
    existing.push(bulletLine);
    grouped.set(sectionTitle, existing);
  }
  return grouped;
}

function sectionTitleFor(record: DvRecord): KacSectionTitle {
  switch (record.type) {
    case "feat":
      return "Added";
    case "fix":
      return "Fixed";
    case "feat!":
    case "fix!":
      return "Changed";
  }
}

interface FormatBulletLineArgs {
  record: DvRecord;
  sectionTitle: KacSectionTitle;
}

function formatBulletLine(args: FormatBulletLineArgs): string {
  const headlineText = firstLineOf(args.record.body).trim();
  const isBreaking =
    args.record.type === "feat!" || args.record.type === "fix!";
  const breakingPrefix = isBreaking ? "**BREAKING** " : "";
  const linkSuffix = renderLinkSuffix(args.record.links);
  return `- ${breakingPrefix}${headlineText}${linkSuffix}`;
}

function firstLineOf(body: string): string {
  const newlineIndex = body.indexOf("\n");
  return newlineIndex === -1 ? body : body.slice(0, newlineIndex);
}

function renderLinkSuffix(links: string[]): string {
  if (links.length === 0) return "";
  const renderedLinks = links.map((url) => `[link](${url})`).join(", ");
  return ` (${renderedLinks})`;
}
