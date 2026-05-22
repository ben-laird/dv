import { assertEquals } from "@std/assert";
import type { Bump } from "../../domain/bump.ts";
import { CHANGE_TYPES, type ChangeType } from "../../domain/change-type.ts";
import type { Stability } from "../../domain/stability.ts";
import { classify } from "./classify.ts";

interface ClassifyExpectation {
  changeType: ChangeType;
  stability: Stability;
  expectedBump: Bump;
}

// The full table from specs/language.md § classify.
const FULL_CLASSIFY_TABLE: ClassifyExpectation[] = [
  { changeType: "fix", stability: "Stable", expectedBump: "patch" },
  { changeType: "feat", stability: "Stable", expectedBump: "minor" },
  { changeType: "feat!", stability: "Stable", expectedBump: "major" },
  { changeType: "fix!", stability: "Stable", expectedBump: "major" },
  { changeType: "fix", stability: "Unstable", expectedBump: "patch" },
  { changeType: "feat", stability: "Unstable", expectedBump: "minor" },
  { changeType: "feat!", stability: "Unstable", expectedBump: "minor" },
  { changeType: "fix!", stability: "Unstable", expectedBump: "minor" },
];

Deno.test("classify maps every (ChangeType, Stability) cell per the spec table", () => {
  // Given each cell of the documented table
  for (const expectation of FULL_CLASSIFY_TABLE) {
    // When classify runs
    const computedBump = classify({
      changeType: expectation.changeType,
      stability: expectation.stability,
    });

    // Then it returns the expected Bump
    assertEquals(
      computedBump,
      expectation.expectedBump,
      `classify(${expectation.changeType}, ${expectation.stability})`,
    );
  }
});

Deno.test("classify never returns 'major' in the Unstable regime (Algebra §3)", () => {
  // Given every ChangeType paired with Unstable
  for (const changeType of CHANGE_TYPES) {
    // When classify runs
    const computedBump = classify({ changeType, stability: "Unstable" });

    // Then the result is never 'major' — the cap that makes no Record
    // produce 1.0.0
    assertEquals(
      computedBump === "major",
      false,
      `classify(${changeType}, Unstable) must not be major`,
    );
  }
});
