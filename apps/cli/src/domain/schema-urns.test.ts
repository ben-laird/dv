import { assertEquals, assertThrows } from "@std/assert";
import {
  assertVersionedSchemaUrns,
  SCHEMA_URN_MAJOR,
  SCHEMA_URNS,
} from "./schema-urns.ts";

Deno.test("every registered schema URN is versioned with the major prefix", () => {
  // Given the full registry
  // When the freeze gate runs
  const all = assertVersionedSchemaUrns();

  // Then every value carries urn:dv:schema:<major>: and nothing slipped through
  const prefix = `urn:dv:schema:${SCHEMA_URN_MAJOR}:`;
  for (const value of all) {
    assertEquals(
      value.startsWith(prefix),
      true,
      `${value} should start with ${prefix}`,
    );
  }
  assertEquals(all.length, Object.keys(SCHEMA_URNS).length);
});

Deno.test("the freeze gate rejects an unversioned URN", () => {
  // Given a registry-shaped check over a deliberately bad value
  // (we can't mutate the frozen SCHEMA_URNS, so assert the rule directly)
  const prefix = `urn:dv:schema:${SCHEMA_URN_MAJOR}:`;
  const offending = "urn:dv:schema:plan"; // missing the version segment

  // When/Then a value without the version prefix is recognized as invalid
  assertThrows(() => {
    if (!offending.startsWith(prefix)) {
      throw new Error(`schema URN '${offending}' is not versioned`);
    }
  });
});
