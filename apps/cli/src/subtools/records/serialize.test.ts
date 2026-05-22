import { assertEquals, assertStringIncludes } from "@std/assert";
import { parseRecord } from "./parse.ts";
import { serializeRecord } from "./serialize.ts";

Deno.test("serializeRecord emits frontmatter then the body verbatim", () => {
  // Given fresh inputs for a new Record
  const serializeInputs = {
    type: "feat" as const,
    packages: ["core", "cli"],
    body: "Add OAuth device flow.",
  };

  // When the Record is serialized
  const serialized = serializeRecord(serializeInputs);

  // Then it carries the frontmatter delimiters, both required fields, and the body
  assertStringIncludes(serialized, "---\n");
  assertStringIncludes(serialized, "type: feat");
  assertStringIncludes(serialized, "packages:");
  assertStringIncludes(serialized, "Add OAuth device flow.");
});

Deno.test("serializeRecord round-trips through parseRecord", () => {
  // Given a full set of fields including the optional ones
  const inputs = {
    type: "fix!" as const,
    packages: ["engine"],
    body: "Drop legacy API.",
    links: ["https://example.com/pr/42"],
    notes: "Reviewer-only context.",
  };

  // When the Record is serialized and re-parsed
  const serialized = serializeRecord(inputs);
  const parsedRecord = parseRecord({
    fileContents: serialized,
    recordPath: "x.md",
  });

  // Then every field survives the round trip
  assertEquals(parsedRecord.type, "fix!");
  assertEquals(parsedRecord.packages, ["engine"]);
  assertEquals(parsedRecord.links, ["https://example.com/pr/42"]);
  assertEquals(parsedRecord.notes, "Reviewer-only context.");
  assertEquals(parsedRecord.body, "Drop legacy API.");
});

Deno.test("serializeRecord omits optional fields that are empty", () => {
  // Given inputs with an empty links array and whitespace-only notes
  const inputs = {
    type: "feat" as const,
    packages: ["core"],
    body: "Body.",
    links: [],
    notes: "  ",
  };

  // When the Record is serialized
  const serialized = serializeRecord(inputs);

  // Then the optional keys are dropped from the frontmatter
  assertEquals(serialized.includes("links:"), false);
  assertEquals(serialized.includes("notes:"), false);
});
