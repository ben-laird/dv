import { assertEquals, assertThrows } from "@std/assert";
import { parseRecord, RecordError } from "./parse.ts";

Deno.test("parseRecord reads a well-formed Record into the typed Record shape", () => {
  // Given a Record file with required frontmatter and a non-empty body
  const validRecordContents = `---
type: feat
packages: [core, cli]
links:
  - https://example.com/issue/1
---

Add OAuth device flow.
`;

  // When parseRecord parses it
  const parsedRecord = parseRecord({
    fileContents: validRecordContents,
    recordPath: "/repo/.changelog/records/quiet-cats-sneeze.md",
  });

  // Then frontmatter fields land on the typed Record and the body is trimmed
  assertEquals(parsedRecord.filename, "quiet-cats-sneeze.md");
  assertEquals(parsedRecord.type, "feat");
  assertEquals(parsedRecord.packages, ["core", "cli"]);
  assertEquals(parsedRecord.links, ["https://example.com/issue/1"]);
  assertEquals(parsedRecord.body, "Add OAuth device flow.");
});

Deno.test("parseRecord defaults `links` to [] when the frontmatter omits it", () => {
  // Given a minimal Record without optional fields
  const minimalRecordContents = `---
type: fix
packages: [core]
---

Patch a bug.
`;

  // When parseRecord parses it
  const parsedRecord = parseRecord({
    fileContents: minimalRecordContents,
    recordPath: "x.md",
  });

  // Then links is the empty array (the parser-shape applies the default)
  assertEquals(parsedRecord.links, []);
  assertEquals(parsedRecord.notes, undefined);
});

Deno.test("parseRecord rejects a file with no frontmatter block", () => {
  // Given a markdown file that lacks the leading `---` frontmatter
  const recordWithoutFrontmatter = `just a body\n`;

  // When parseRecord runs
  // Then it throws RecordError with code 'frontmatter-missing'
  assertThrows(
    () =>
      parseRecord({
        fileContents: recordWithoutFrontmatter,
        recordPath: "x.md",
      }),
    RecordError,
    "missing the leading YAML frontmatter",
  );
});

Deno.test("parseRecord rejects an unknown Change Type", () => {
  // Given a Record using a Conventional Commits type dv doesn't accept
  const recordWithBadType = `---
type: chore
packages: [core]
---

body
`;

  // When parseRecord runs
  // Then it throws RecordError mentioning the offending key
  assertThrows(
    () => parseRecord({ fileContents: recordWithBadType, recordPath: "x.md" }),
    RecordError,
    "type",
  );
});

Deno.test("parseRecord rejects an empty packages list", () => {
  // Given a Record with `packages: []`
  const recordWithEmptyPackages = `---
type: feat
packages: []
---

body
`;

  // When parseRecord runs
  // Then it throws RecordError flagging the packages array
  assertThrows(
    () =>
      parseRecord({
        fileContents: recordWithEmptyPackages,
        recordPath: "x.md",
      }),
    RecordError,
    "packages",
  );
});

Deno.test("parseRecord rejects an empty body", () => {
  // Given a Record with no markdown body after frontmatter
  const recordWithEmptyBody = `---
type: feat
packages: [core]
---


`;

  // When parseRecord runs
  // Then it throws RecordError with the body-empty code
  assertThrows(
    () =>
      parseRecord({
        fileContents: recordWithEmptyBody,
        recordPath: "x.md",
      }),
    RecordError,
    "body",
  );
});
