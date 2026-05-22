import { assertEquals } from "@std/assert";
import { formatVersion, parseVersion } from "../../domain/version.ts";
import { applyBump } from "./apply.ts";

Deno.test("applyBump increments patch and resets nothing else", () => {
  // Given a version with non-zero minor and patch
  const startingVersion = parseVersion("1.4.2");

  // When a patch bump is applied
  const bumped = applyBump({ version: startingVersion, bump: "patch" });

  // Then only the patch field advances
  assertEquals(formatVersion(bumped), "1.4.3");
});

Deno.test("applyBump on minor bumps minor and zeroes patch", () => {
  // Given a version with non-zero patch
  const startingVersion = parseVersion("1.4.2");

  // When a minor bump is applied
  const bumped = applyBump({ version: startingVersion, bump: "minor" });

  // Then minor advances and patch is zeroed
  assertEquals(formatVersion(bumped), "1.5.0");
});

Deno.test("applyBump on major bumps major and zeroes minor and patch", () => {
  // Given a version with non-zero minor and patch
  const startingVersion = parseVersion("1.4.2");

  // When a major bump is applied
  const bumped = applyBump({ version: startingVersion, bump: "major" });

  // Then major advances and minor and patch are zeroed
  assertEquals(formatVersion(bumped), "2.0.0");
});

Deno.test("applyBump never promotes Unstable to 1.0.0 (Algebra §3)", () => {
  // Given any pre-1.0 version
  const unstableVersion = parseVersion("0.4.2");

  // When the largest bump classify can yield for Unstable (minor) is applied
  const bumped = applyBump({ version: unstableVersion, bump: "minor" });

  // Then the major component remains 0
  assertEquals(bumped.major, 0);
  assertEquals(formatVersion(bumped), "0.5.0");
});
