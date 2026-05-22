import { assertEquals } from "@std/assert";
import { type Bump, BUMPS } from "../../domain/bump.ts";
import { joinBumps } from "./bump-join.ts";

Deno.test("joinBumps takes the chain max — three fixes and one feat join to minor", () => {
  // Given three fix bumps and one feat bump
  // When folded with joinBumps
  const aggregated = ["patch", "patch", "patch", "minor"].reduce<Bump>(
    (left, right) => joinBumps(left, right as Bump),
    "patch",
  );

  // Then the result is the max — minor
  assertEquals(aggregated, "minor");
});

Deno.test("joinBumps absorbs every smaller bump into a major (Stable breaking)", () => {
  // Given a sequence with one major and several smaller bumps
  // When folded
  const aggregated = ["patch", "minor", "major", "patch"].reduce<Bump>(
    (left, right) => joinBumps(left, right as Bump),
    "patch",
  );

  // Then the result is major
  assertEquals(aggregated, "major");
});

Deno.test("joinBumps is commutative across every pair (specs/language.md Algebra §1)", () => {
  // Given every ordered pair of bumps
  for (const left of BUMPS) {
    for (const right of BUMPS) {
      // When joined in both orders
      const forward = joinBumps(left, right);
      const reversed = joinBumps(right, left);

      // Then the results agree
      assertEquals(
        forward,
        reversed,
        `joinBumps(${left}, ${right}) vs joinBumps(${right}, ${left})`,
      );
    }
  }
});

Deno.test("joinBumps is associative across every triple", () => {
  // Given every triple of bumps
  for (const a of BUMPS) {
    for (const b of BUMPS) {
      for (const c of BUMPS) {
        // When grouped left-to-right and right-to-left
        const leftGrouped = joinBumps(joinBumps(a, b), c);
        const rightGrouped = joinBumps(a, joinBumps(b, c));

        // Then both groupings agree
        assertEquals(
          leftGrouped,
          rightGrouped,
          `associativity at (${a}, ${b}, ${c})`,
        );
      }
    }
  }
});

Deno.test("joinBumps is idempotent: joining a bump with itself yields itself", () => {
  // Given each bump
  for (const bump of BUMPS) {
    // When joined with itself
    // Then the result is unchanged
    assertEquals(joinBumps(bump, bump), bump);
  }
});
