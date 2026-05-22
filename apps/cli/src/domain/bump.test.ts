import { assertEquals } from "@std/assert";
import { BUMPS, type Bump, bumpRank } from "./bump.ts";

Deno.test("bumpRank orders bumps as patch < minor < major", () => {
  // Given the three Bump values
  // When ranked
  // Then ranks form the documented chain (specs/language.md § Domains)
  assertEquals(bumpRank("patch"), 0);
  assertEquals(bumpRank("minor"), 1);
  assertEquals(bumpRank("major"), 2);
});

Deno.test("BUMPS lists every Bump exactly once and in chain order", () => {
  // Given the const tuple
  // When inspected
  // Then it matches the canonical chain order
  assertEquals(BUMPS, ["patch", "minor", "major"] as const);
  const everyBumpInTuple: Bump[] = [...BUMPS];
  assertEquals(everyBumpInTuple.length, 3);
});
