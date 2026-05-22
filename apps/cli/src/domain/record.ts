import type { ChangeType } from "./change-type.ts";

// A Record is "a pending, committed account of one change" — Change Type,
// affected Packages, optional links/notes, free-form markdown body
// (specs/language.md § Lexicon, specs/record-format.md).
//
// We carry the source filename so error messages can point users at the
// offending file. `body` is the raw markdown after the closing `---`
// frontmatter delimiter — preserved verbatim for the CHANGELOG renderer.

export interface Record {
  filename: string;
  type: ChangeType;
  packages: string[];
  links: string[];
  notes?: string;
  body: string;
}
