import { assertEquals } from "@std/assert";
import { basename, fromFileUrl } from "@std/path";
import {
  PUBLISHED_SCHEMA_NAMES,
  publishedSchemaUrl,
} from "./published-schema.ts";

const PACKAGE_SCHEMAS_DIRECTORY = fromFileUrl(
  new URL("../../schemas/", import.meta.url),
);

Deno.test("publishedSchemaUrl points at the versioned JSR path of the schema file", () => {
  // Given a dv release and the config schema
  const version = "0.11.0";

  // When the published URL is built
  const url = publishedSchemaUrl({ version, schema: "config" });

  // Then it is JSR's immutable per-version file URL under schemas/
  assertEquals(url, "https://jsr.io/@dv-cli/dv/0.11.0/schemas/config.json");
});

Deno.test("publishedSchemaUrl keeps prerelease versions verbatim", () => {
  // Given a prerelease version
  const version = "1.0.0-rc.1";

  // When the published URL is built for a result envelope
  const url = publishedSchemaUrl({ version, schema: "plan" });

  // Then the version segment is the version exactly as released
  assertEquals(url, "https://jsr.io/@dv-cli/dv/1.0.0-rc.1/schemas/plan.json");
});

Deno.test("every published schema name has a file in the package's schemas directory, and vice versa", async () => {
  // Given the JSON files committed under apps/cli/schemas/
  const committedSchemaNames: string[] = [];
  for await (const entry of Deno.readDir(PACKAGE_SCHEMAS_DIRECTORY)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      committedSchemaNames.push(basename(entry.name, ".json"));
    }
  }

  // When compared with the published-schema registry
  const registeredSchemaNames = [...PUBLISHED_SCHEMA_NAMES].sort();

  // Then the two sets match, so no published URL can point at a missing file
  assertEquals(committedSchemaNames.sort(), registeredSchemaNames);
});
