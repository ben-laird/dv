// The Change Type union from specs/language.md § Lexicon: the four
// Conventional Commits flavors dv accepts. The `!` denotes a breaking
// change. No other CC types (`chore`, `docs`, etc.) are accepted in
// Records — they live in git history, not CHANGELOG
// (.claude/CLAUDE.md § Strong opinions).

export const CHANGE_TYPES = ["feat", "fix", "feat!", "fix!"] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export function isChangeType(candidate: unknown): candidate is ChangeType {
  return (
    typeof candidate === "string" &&
    (CHANGE_TYPES as readonly string[]).includes(candidate)
  );
}
