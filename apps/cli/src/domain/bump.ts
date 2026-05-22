// A Bump is a SemVer increment level — `patch ⊏ minor ⊏ major`
// (specs/language.md § Lexicon, § Domains). `Bump` is a chain, which is
// what makes the join in Algebra §1 well-defined and order-independent.

export const BUMPS = ["patch", "minor", "major"] as const;

export type Bump = (typeof BUMPS)[number];

// Rank a Bump on the chain. `joinBumps` in the versioning subtool uses
// this to take the max — the formal content of Algebra §1.
export function bumpRank(bump: Bump): 0 | 1 | 2 {
  switch (bump) {
    case "patch":
      return 0;
    case "minor":
      return 1;
    case "major":
      return 2;
  }
}
