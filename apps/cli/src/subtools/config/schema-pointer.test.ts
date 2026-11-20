import { assertEquals } from "@std/assert";
import { dvConfigSchemaVersion, readSchemaPointers } from "./schema-pointer.ts";

Deno.test("readSchemaPointers finds the modeline and the top-level $schema key", () => {
  // Given a config with both pointers, the key quoted and commented
  const configText = `# yaml-language-server: $schema=./a.json
discovery: {}
$schema: "./b.json" # pinned
`;

  // When the pointers are read
  const pointers = readSchemaPointers(configText);

  // Then both URLs are found without their quotes
  assertEquals(pointers, { modeline: "./a.json", key: "./b.json" });
});

Deno.test("readSchemaPointers reports a missing pointer as absent and ignores nested keys", () => {
  // Given a config with no modeline and only a nested $schema key
  const configText = `publishing:
  $schema: ./nested.json
`;

  // When the pointers are read
  const pointers = readSchemaPointers(configText);

  // Then neither pointer is present
  assertEquals(pointers, {});
});

Deno.test("dvConfigSchemaVersion extracts the version only from dv's published config schema URL", () => {
  // Given dv's config schema URL, another dv schema, and a foreign URL
  // When each is inspected
  // Then only the dv config schema yields a version
  assertEquals(
    dvConfigSchemaVersion(
      "https://jsr.io/@dv-cli/dv/0.12.0/schemas/config.json",
    ),
    "0.12.0",
  );
  assertEquals(
    dvConfigSchemaVersion("https://jsr.io/@dv-cli/dv/0.12.0/schemas/plan.json"),
    undefined,
  );
  assertEquals(
    dvConfigSchemaVersion("https://example.com/0.12.0/schemas/config.json"),
    undefined,
  );
});
