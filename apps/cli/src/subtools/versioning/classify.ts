import type { Bump } from "../../domain/bump.ts";
import type { ChangeType } from "../../domain/change-type.ts";
import type { Stability } from "../../domain/stability.ts";

// classify maps (ChangeType, Stability) → Bump per the table in
// specs/language.md § classify. The Unstable column caps the Stable
// column at minor — the formal content of Algebra §2 and the proof
// (with Algebra §3) that no Record can produce 1.0.0.

export interface ClassifyArgs {
  changeType: ChangeType;
  stability: Stability;
}

export function classify(args: ClassifyArgs): Bump {
  const stableBump = classifyStable(args.changeType);
  return args.stability === "Unstable" ? capAtMinor(stableBump) : stableBump;
}

function classifyStable(changeType: ChangeType): Bump {
  switch (changeType) {
    case "fix":
      return "patch";
    case "feat":
      return "minor";
    case "feat!":
    case "fix!":
      return "major";
  }
}

function capAtMinor(bump: Bump): Bump {
  return bump === "major" ? "minor" : bump;
}
