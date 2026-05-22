// dv's Record-type vocabulary (specs/language.md § Lexicon). These four
// flavors come from Record frontmatter — dv never parses commit
// messages, so this is a closed set of values dv defines. The vocabulary
// happens to match a Conventional Commits subset, which is a
// familiarity choice for teams already on CC; it is not a contract on
// contributors. The `!` denotes a breaking change. Anything outside
// these four values is outside dv's vocabulary entirely and is rejected
// at parse time (.claude/CLAUDE.md § Strong opinions; specs/design.md §
// Records over commit messages).

export const CHANGE_TYPES = ["feat", "fix", "feat!", "fix!"] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export function isChangeType(candidate: unknown): candidate is ChangeType {
  return (
    typeof candidate === "string" &&
    (CHANGE_TYPES as readonly string[]).includes(candidate)
  );
}
