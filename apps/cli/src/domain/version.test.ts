import { assertEquals, assertThrows } from "@std/assert";
import { DvError } from "./errors.ts";
import { compareVersions, formatVersion, parseVersion } from "./version.ts";

Deno.test("parseVersion roundtrips through formatVersion for a standard semver", () => {
  // Given a textual semver
  const rawText = "1.4.2";

  // When parsed and then formatted
  const parsedVersion = parseVersion(rawText);
  const reformatted = formatVersion(parsedVersion);

  // Then the round trip is exact
  assertEquals(reformatted, rawText);
  assertEquals(parsedVersion.major, 1);
  assertEquals(parsedVersion.minor, 4);
  assertEquals(parsedVersion.patch, 2);
});

Deno.test("parseVersion throws DvError with code 'version-parse' on garbage input", () => {
  // Given a string that is not semver
  const rawText = "not-a-version";

  // When parsed
  // Then a DvError surfaces with the documented code
  const caught = assertThrows(() => parseVersion(rawText), DvError);
  assertEquals(caught.code, "version-parse");
});

Deno.test("compareVersions orders versions by semver precedence", () => {
  // Given three versions in unsorted order
  const earlier = parseVersion("1.4.2");
  const middle = parseVersion("1.5.0");
  const later = parseVersion("2.0.0");

  // When compared pairwise
  // Then results carry the expected sign
  assertEquals(compareVersions(earlier, middle) < 0, true);
  assertEquals(compareVersions(middle, later) < 0, true);
  assertEquals(compareVersions(later, earlier) > 0, true);
  assertEquals(compareVersions(middle, middle), 0);
});
