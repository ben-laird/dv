import { type Bump, bumpRank } from "../../domain/bump.ts";

// joinBumps takes the chain max of two Bumps (specs/language.md
// Algebra §1). Because `Bump` is a totally ordered chain
// `patch ⊏ minor ⊏ major`, the join is `max` — commutative, associative,
// and idempotent. That's the law that lets `aggregateBumps` combine
// records in any order and reach the same result.

export function joinBumps(left: Bump, right: Bump): Bump {
  return bumpRank(left) >= bumpRank(right) ? left : right;
}
