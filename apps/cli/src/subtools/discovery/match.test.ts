import { assertEquals } from "@std/assert";
import { matchesAny, normalizePath, splitMatch } from "./match.ts";

Deno.test("splitMatch on a single string yields one positive glob and no negatives", () => {
  // Given a plugin assignment with a single-string match
  const singleStringMatch = "packages/*";

  // When the match is split
  const splitResult = splitMatch(singleStringMatch);

  // Then there is one positive glob and no negative globs
  assertEquals(splitResult, {
    positiveGlobs: ["packages/*"],
    negativeGlobs: [],
  });
});

Deno.test("splitMatch peels '!'-prefixed entries into the negative bucket", () => {
  // Given a list-of-globs match mixing positive and gitignore-style negation
  const mixedMatchList = ["packages/*", "!packages/legacy", "apps/*"];

  // When the match is split
  const splitResult = splitMatch(mixedMatchList);

  // Then negatives have the '!' stripped and positives keep their order
  assertEquals(splitResult, {
    positiveGlobs: ["packages/*", "apps/*"],
    negativeGlobs: ["packages/legacy"],
  });
});

Deno.test("normalizePath removes trailing slashes so paths compare equal", () => {
  // Given a discovered package path with a trailing slash
  const pathWithTrailingSlash = "packages/core/";

  // When the path is normalized
  const normalized = normalizePath(pathWithTrailingSlash);

  // Then the trailing slash is gone
  assertEquals(normalized, "packages/core");
});

Deno.test("matchesAny returns true iff the candidate matches at least one glob", () => {
  // Given a candidate package path and several glob sets
  const candidatePath = "packages/legacy";

  // When matched against globs that should/shouldn't include it
  // Then results follow the documented semantics
  assertEquals(matchesAny({ candidatePath, globs: ["packages/legacy"] }), true);
  assertEquals(matchesAny({ candidatePath, globs: ["packages/*"] }), true);
  assertEquals(
    matchesAny({ candidatePath: "apps/cli", globs: ["packages/*"] }),
    false,
  );
});
