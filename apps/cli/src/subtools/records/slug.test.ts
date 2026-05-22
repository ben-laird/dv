import { assertEquals, assertMatch } from "@std/assert";
import { generateSlug, type SlugRandomSource } from "./slug.ts";

Deno.test("generateSlug emits exactly three lowercase words joined by hyphens", () => {
  // Given the default random source

  // When generateSlug runs
  const slug = generateSlug();

  // Then the slug matches the documented three-word pattern
  assertMatch(slug, /^[a-z]+-[a-z]+-[a-z]+$/);
});

Deno.test("generateSlug is deterministic when given a deterministic random source", () => {
  // Given a fixed-sequence RNG that hands out the same three values each call
  const fixedSequence = [0.1, 0.5, 0.9];
  let nextIndex = 0;
  const deterministicSource: SlugRandomSource = {
    next: () => {
      const value = fixedSequence[nextIndex % fixedSequence.length]!;
      nextIndex++;
      return value;
    },
  };

  // When generateSlug runs twice with the same RNG state alignment
  nextIndex = 0;
  const firstSlug = generateSlug({ randomSource: deterministicSource });
  nextIndex = 0;
  const secondSlug = generateSlug({ randomSource: deterministicSource });

  // Then both runs produce the same slug
  assertEquals(firstSlug, secondSlug);
});
