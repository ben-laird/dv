// A Rename is "a recorded lineage edge from → to" in the rename ledger
// `.changelog/renames.yaml` (specs/language.md § Lexicon). The `at` field
// records the new Package's first Version under its new name — used by
// the changelog renderer when stitching history; not load-bearing for
// resolution itself, which follows the reflexive-transitive closure of
// the edge graph (Algebra §8).

export interface Rename {
  from: string;
  to: string;
  at: string;
}
