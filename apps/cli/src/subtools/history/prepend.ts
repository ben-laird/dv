// Prepends a freshly-rendered HISTORY section into an existing
// HISTORY.md text. Pure: takes the existing text and a new section,
// returns the combined text. The IO wrappers (read / write) live in
// io.ts.
//
// Splice rule mirrors the CHANGELOG renderer's: insert the new section
// immediately above the first `## ` heading that is not
// `## [Unreleased]`, or append after the preamble if no version
// sections exist yet. Code is intentionally duplicated rather than
// shared with subtools/changelog — the two documents may diverge over
// time (e.g. HISTORY could grow per-Package h4 subsections; CHANGELOG
// stays terse). Three similar lines is better than a premature
// abstraction.
//
// New HISTORYs (file absent on disk) get a HISTORY preamble + the new
// section. The preamble is intentionally distinct from KaC's — HISTORY
// is a narrative document, not a Keep a Changelog one.

const HISTORY_PREAMBLE = `# History

Long-form release notes for this Package. Each version section carries
one h3 subsection per Record consumed during that release, with the
Record's body prose verbatim. For terse one-line bullets, see
CHANGELOG.md.
`;

export function buildFreshHistory(newSection: string): string {
  return `${HISTORY_PREAMBLE}\n${ensureTrailingNewline(newSection)}`;
}

export interface PrependHistorySectionArgs {
  existingText: string;
  newSection: string;
}

export function prependHistorySection(args: PrependHistorySectionArgs): string {
  const normalizedNewSection = ensureTrailingNewline(args.newSection);
  const insertionIndex = findFirstVersionHeadingIndex(args.existingText);
  if (insertionIndex === -1) {
    const separator = args.existingText.endsWith("\n\n")
      ? ""
      : args.existingText.endsWith("\n")
        ? "\n"
        : "\n\n";
    return `${args.existingText}${separator}${normalizedNewSection}`;
  }
  return `${args.existingText.slice(0, insertionIndex)}${normalizedNewSection}\n${args.existingText.slice(insertionIndex)}`;
}

function findFirstVersionHeadingIndex(existingText: string): number {
  let searchOffset = 0;
  while (searchOffset < existingText.length) {
    const newlineIndex = existingText.indexOf("\n", searchOffset);
    const lineEnd = newlineIndex === -1 ? existingText.length : newlineIndex;
    const lineText = existingText.slice(searchOffset, lineEnd);
    const isAtLineStart =
      searchOffset === 0 || existingText[searchOffset - 1] === "\n";
    if (
      isAtLineStart &&
      lineText.startsWith("## ") &&
      !lineText.startsWith("## [Unreleased]")
    ) {
      return searchOffset;
    }
    if (newlineIndex === -1) break;
    searchOffset = newlineIndex + 1;
  }
  return -1;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
