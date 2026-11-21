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
      const value = fixedSequence[nextIndex % fixedSequence.length];
      nextIndex++;
      if (value === undefined) throw new Error("index is modulo the length");
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

Deno.test("generateSlug falls back to the first words for an out-of-range source", () => {
  // Given sources returning 1 and NaN, past the [0, 1) a source should give,
  // and one returning 0, which picks the first word of each list
  const firstWords = generateSlug({ randomSource: { next: () => 0 } });

  // When generateSlug runs with each out-of-range source
  const fromOne = generateSlug({ randomSource: { next: () => 1 } });
  const fromNaN = generateSlug({ randomSource: { next: () => Number.NaN } });

  // Then both fall back to the first word of every list, as before
  assertEquals(fromOne, firstWords);
  assertEquals(fromNaN, firstWords);
});
