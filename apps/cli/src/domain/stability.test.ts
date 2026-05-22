import { assertEquals } from "@std/assert";
import { stabilityOf } from "./stability.ts";
import { parseVersion } from "./version.ts";

Deno.test("stabilityOf classifies 0.x.y as Unstable", () => {
  // Given a pre-1.0 Version
  const earlyVersion = parseVersion("0.4.1");

  // When asked for its Stability
  const stability = stabilityOf(earlyVersion);

  // Then it falls in the Unstable regime (specs/language.md § Stability)
  assertEquals(stability, "Unstable");
});

Deno.test("stabilityOf classifies 1.0.0 and above as Stable", () => {
  // Given two post-1.0 Versions
  const justStable = parseVersion("1.0.0");
  const wellEstablished = parseVersion("4.7.0");

  // When asked for their Stability
  // Then both are Stable
  assertEquals(stabilityOf(justStable), "Stable");
  assertEquals(stabilityOf(wellEstablished), "Stable");
});
