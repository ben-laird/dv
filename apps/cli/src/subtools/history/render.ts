import type { Record as DvRecord } from "../../domain/record.ts";
import { extractHeadline } from "../changelog/render.ts";

// Renders one HISTORY release section from the set of Records that
// fed a Package's Bump. Pure: no IO, no current date discovery
// (the caller passes `dateString` so tests are deterministic).
//
// Format — per-Record h3 subsections under a per-version h2:
//
//   ## [1.5.0] - 2026-05-22
//
//   ### Implement device flow
//
//   (the body prose below the Record's h1)
//
//   ### Patch the parser
//
//   ...
//
// The h3 title is the Record's headline (same `extractHeadline` rule
// the CHANGELOG renderer uses, for symmetry). The body content of
// each h3 entry is the Record body *below* its h1 — the prose that
// the CHANGELOG bullet doesn't carry. Records without a leading h1
// (the pre-v1 convention) use the full body as the entry content
// and the first non-empty line as the title.
//
// Records aren't grouped by Change Type here. HISTORY is a
// narrative document, not a structured release-notes file — readers
// scanning for "what shipped" use CHANGELOG; readers scanning for
// "why these decisions" read HISTORY in chronological order within
// each version section.

export interface RenderHistorySectionArgs {
  newVersion: string;
  records: DvRecord[];
  dateString: string;
}

export function renderHistorySection(args: RenderHistorySectionArgs): string {
  const heading = `## [${args.newVersion}] - ${args.dateString}`;
  const entryBlocks = args.records.map((record) => renderHistoryEntry(record));
  if (entryBlocks.length === 0) return `${heading}\n`;
  return `${heading}\n\n${entryBlocks.join("\n\n")}\n`;
}

function renderHistoryEntry(record: DvRecord): string {
  const headline = extractHeadline(record.body);
  const bodyBelowHeadline = stripLeadingHeadline(record.body);
  if (bodyBelowHeadline.length === 0) {
    return `### ${headline}`;
  }
  return `### ${headline}\n\n${bodyBelowHeadline}`;
}

// Strips the Record's headline (the leading h1 OR the first non-empty
// line, matching extractHeadline's recognition rule) and any blank
// lines that follow it, returning the rest of the body. Trailing
// whitespace is trimmed so consecutive entries don't accumulate blank
// lines between them.
function stripLeadingHeadline(body: string): string {
  const lines = body.split("\n");
  let cursor = 0;
  // Skip leading blank lines before the headline (extractHeadline does
  // the same).
  while (cursor < lines.length && (lines[cursor] ?? "").trim().length === 0) {
    cursor += 1;
  }
  // Skip exactly the headline line itself, whether it's an h1 or a
  // bare first-line.
  if (cursor < lines.length) cursor += 1;
  // Skip blank lines between the headline and the body proper, so the
  // emitted entry doesn't have a stray blank line at the top.
  while (cursor < lines.length && (lines[cursor] ?? "").trim().length === 0) {
    cursor += 1;
  }
  return lines.slice(cursor).join("\n").trimEnd();
}
