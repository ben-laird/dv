// The Change Type union from specs/language.md § Lexicon. Vocabulary
// borrowed from Conventional Commits, but dv never parses commit
// messages — these flavors come from Record frontmatter. The `!` denotes
// a breaking change. Other CC types (`chore`, `docs`, etc.) are not
// accepted in Records: they live in git history, not CHANGELOG
// (.claude/CLAUDE.md § Strong opinions; specs/design.md § Records over
// commit messages).

export const CHANGE_TYPES = ["feat", "fix", "feat!", "fix!"] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export function isChangeType(candidate: unknown): candidate is ChangeType {
  return (
    typeof candidate === "string" &&
    (CHANGE_TYPES as readonly string[]).includes(candidate)
  );
}
