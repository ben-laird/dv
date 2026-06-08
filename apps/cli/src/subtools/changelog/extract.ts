// Extracts one Keep a Changelog release section back out of a rendered
// CHANGELOG.md — the inverse of `renderReleaseSection`. Pure: text in,
// text out, no IO.
//
// `dv release` runs *after* `dv version` has consumed the Records that fed
// the notes, so it can't re-render them. But dv owns the CHANGELOG format,
// so a first-party extractor recovers the notes from the file dv itself
// wrote — without every consumer rolling its own fragile slice.
//
// The slice matches the heading `renderReleaseSection` emits
// (`## [<version>] - <date>`): find the target `## [<version>]` line, take
// everything up to the next `## [` heading (or EOF), drop the heading line
// itself (the Release title already carries the tag), and trim surrounding
// blank lines.

export interface ExtractReleaseSectionArgs {
  /** Full text of a CHANGELOG.md. */
  changelogText: string;
  /** The exact version whose section to extract (no `v` prefix). */
  version: string;
}

/**
 * Returns the body of the `## [<version>]` section of a CHANGELOG (heading
 * dropped, surrounding blank lines trimmed), or `null` when no section for
 * that version exists.
 */
export function extractReleaseSection(
  args: ExtractReleaseSectionArgs,
): string | null {
  const lines = args.changelogText.split("\n");

  const isVersionHeading = (line: string): boolean => line.startsWith("## [");
  const isTargetHeading = (line: string): boolean =>
    line.startsWith(`## [${args.version}]`);

  const startIndex = lines.findIndex(isTargetHeading);
  if (startIndex === -1) return null;

  let endIndex = lines.length;
  for (let lineIndex = startIndex + 1; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    if (isVersionHeading(line)) {
      endIndex = lineIndex;
      break;
    }
  }

  return lines
    .slice(startIndex + 1, endIndex)
    .join("\n")
    .trim();
}
