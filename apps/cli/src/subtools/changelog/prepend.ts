// Prepends a freshly-rendered release section into an existing
// CHANGELOG.md text (Keep a Changelog format). Pure: takes the existing
// text and a new section, returns the combined text. The IO wrappers
// (read / write) live in io.ts.
//
// Where to insert:
//   - If the file has no `## ` lines at all → put the new section after
//     the preamble (or at the top if no preamble), separated by a blank
//     line.
//   - If the file already has version sections → insert the new section
//     immediately above the first `## ` that is not `## [Unreleased]`.
//   - If only `## [Unreleased]` exists → insert after the Unreleased
//     section (between Unreleased and any subsequent content, or at the
//     end if Unreleased is the last thing).
//
// New CHANGELOGs (file absent on disk) get a KaC preamble + the new
// section. That logic lives in io.ts so this pure helper stays
// concerned only with the splice.

const KAC_PREAMBLE = `# Changelog

All notable changes to this Package are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this Package adheres to [Semantic Versioning](https://semver.org/).
`;

export function buildFreshChangelog(newSection: string): string {
  return `${KAC_PREAMBLE}\n${ensureTrailingNewline(newSection)}`;
}

export interface PrependChangelogSectionArgs {
  existingText: string;
  newSection: string;
}

export function prependChangelogSection(
  args: PrependChangelogSectionArgs,
): string {
  const normalizedNewSection = ensureTrailingNewline(args.newSection);
  const insertionIndex = findFirstVersionHeadingIndex(args.existingText);
  if (insertionIndex === -1) {
    // No version sections yet — append after the existing content
    // (which is just preamble), separated by a blank line.
    const separator = args.existingText.endsWith("\n\n")
      ? ""
      : args.existingText.endsWith("\n")
        ? "\n"
        : "\n\n";
    return `${args.existingText}${separator}${normalizedNewSection}`;
  }
  return `${args.existingText.slice(0, insertionIndex)}${normalizedNewSection}\n${args.existingText.slice(insertionIndex)}`;
}

// Index of the first character of the first `## ` line whose heading is
// not `[Unreleased]`. -1 if none exists.
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
