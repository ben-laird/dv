import { assertEquals } from "@std/assert";
import { publishedSchemaUrl } from "../../domain/published-schema.ts";
import {
  diagnoseSchemaPointers,
  dvConfigSchemaVersion,
  readSchemaPointers,
} from "./schema-pointer.ts";

const configSchemaUrlFor = (version: string): string => {
  return publishedSchemaUrl({ version, schema: "config" });
};

Deno.test("diagnoseSchemaPointers finds nothing when both pointers name the running release", () => {
  // Given both pointers at the running release's config schema
  const currentUrl = configSchemaUrlFor("0.14.0");

  // When diagnosed
  const findings = diagnoseSchemaPointers({
    pointers: { modeline: currentUrl, key: currentUrl },
    runningVersion: "0.14.0",
  });

  // Then there is nothing to report
  assertEquals(findings, []);
});

Deno.test("diagnoseSchemaPointers treats a config with neither pointer as opted out", () => {
  // Given no pointers at all
  // When diagnosed
  const findings = diagnoseSchemaPointers({
    pointers: {},
    runningVersion: "0.14.0",
  });

  // Then there is nothing to report
  assertEquals(findings, []);
});

Deno.test("diagnoseSchemaPointers reports a lone pointer as incomplete", () => {
  // Given only a modeline, at a custom schema
  // When diagnosed
  const findings = diagnoseSchemaPointers({
    pointers: { modeline: "./schema.json" },
    runningVersion: "0.14.0",
  });

  // Then it is incomplete, and a non-dv URL is never version-checked
  assertEquals(findings, [
    { kind: "incomplete", present: "modeline", url: "./schema.json" },
  ]);
});

Deno.test("diagnoseSchemaPointers reports each dv pointer at another version with its direction", () => {
  // Given a modeline at an older dv release and a key at a newer one
  // When diagnosed against the running release
  const findings = diagnoseSchemaPointers({
    pointers: {
      modeline: configSchemaUrlFor("0.12.0"),
      key: configSchemaUrlFor("1.0.0"),
    },
    runningVersion: "0.14.0",
  });

  // Then each pointer gets its own mismatch, older and newer
  assertEquals(findings, [
    {
      kind: "version-mismatch",
      pointer: "modeline",
      pointedVersion: "0.12.0",
      direction: "older",
    },
    {
      kind: "version-mismatch",
      pointer: "key",
      pointedVersion: "1.0.0",
      direction: "newer",
    },
  ]);
});

Deno.test("diagnoseSchemaPointers reports a lone outdated dv pointer as both incomplete and mismatched", () => {
  // Given only a $schema key at an older dv release
  const olderUrl = configSchemaUrlFor("0.12.0");

  // When diagnosed
  const findings = diagnoseSchemaPointers({
    pointers: { key: olderUrl },
    runningVersion: "0.14.0",
  });

  // Then both findings are reported
  assertEquals(findings, [
    { kind: "incomplete", present: "key", url: olderUrl },
    {
      kind: "version-mismatch",
      pointer: "key",
      pointedVersion: "0.12.0",
      direction: "older",
    },
  ]);
});

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
