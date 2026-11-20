import { assertEquals } from "@std/assert";
import { publishedSchemaUrl } from "../../domain/published-schema.ts";
import {
  createSchemaPointerStep,
  MODELINE_CHANGE_PATH,
  SCHEMA_KEY_CHANGE_PATH,
  SCHEMA_URL_CHANGE_KIND,
} from "./step-schema-pointer.ts";

// Pure text in / text out. The running version is a parameter, so these
// cases pin their own versions instead of depending on DV_VERSION.

const RUNNING_VERSION = "0.14.0";
const configSchemaUrlFor = (version: string): string => {
  return publishedSchemaUrl({ version, schema: "config" });
};

const configPointingAt = (args: {
  modelineUrl: string;
  keyUrl: string;
}): string => {
  return `# yaml-language-server: $schema=${args.modelineUrl}
#
# dv configuration.

$schema: ${args.keyUrl}

tagging:
  format: "{package}@{version}"
`;
};

Deno.test("schema-pointer step moves both pointers from an older dv release to the running one", () => {
  // Given a config whose modeline and $schema key name an older dv release
  const olderUrl = configSchemaUrlFor("0.12.0");
  const before = configPointingAt({ modelineUrl: olderUrl, keyUrl: olderUrl });
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });

  // When the step applies
  const result = step.apply({ text: before });

  // Then both pointers name the running release and nothing else changed
  const currentUrl = configSchemaUrlFor(RUNNING_VERSION);
  assertEquals(
    result.rewrittenText,
    configPointingAt({ modelineUrl: currentUrl, keyUrl: currentUrl }),
  );
  assertEquals(result.changes, [
    {
      path: MODELINE_CHANGE_PATH,
      before: olderUrl,
      kind: SCHEMA_URL_CHANGE_KIND,
      value: currentUrl,
    },
    {
      path: SCHEMA_KEY_CHANGE_PATH,
      before: olderUrl,
      kind: SCHEMA_URL_CHANGE_KIND,
      value: currentUrl,
    },
  ]);
});

Deno.test("schema-pointer step is a no-op on a config already at the running release", () => {
  // Given a config already pointing at the running release
  const currentUrl = configSchemaUrlFor(RUNNING_VERSION);
  const before = configPointingAt({
    modelineUrl: currentUrl,
    keyUrl: currentUrl,
  });
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });

  // When the step applies
  const result = step.apply({ text: before });

  // Then the text is unchanged and no change is reported
  assertEquals(result.rewrittenText, before);
  assertEquals(result.changes, []);
});

Deno.test("schema-pointer step is idempotent", () => {
  // Given a config migrated once from an older release
  const olderUrl = configSchemaUrlFor("0.12.0");
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });
  const migratedOnce = step.apply({
    text: configPointingAt({ modelineUrl: olderUrl, keyUrl: olderUrl }),
  }).rewrittenText;

  // When the step applies a second time
  const result = step.apply({ text: migratedOnce });

  // Then it reports nothing and leaves the text as it was
  assertEquals(result.changes, []);
  assertEquals(result.rewrittenText, migratedOnce);
});

Deno.test("schema-pointer step leaves non-dv, custom, and newer-dv URLs untouched", () => {
  // Given pointers at a local path, another package's JSR schema, and a
  // newer dv release than the one running
  const cases = [
    { modelineUrl: "../apps/cli/schemas/config.json", keyUrl: "./schema.json" },
    {
      modelineUrl: "https://jsr.io/@someone/fork/0.1.0/schemas/config.json",
      keyUrl: "https://example.com/dv/config.json",
    },
    {
      modelineUrl: configSchemaUrlFor("0.15.0"),
      keyUrl: configSchemaUrlFor("1.0.0"),
    },
  ];
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });

  for (const pointers of cases) {
    const before = configPointingAt(pointers);

    // When the step applies
    const result = step.apply({ text: before });

    // Then nothing is rewritten
    assertEquals(result.rewrittenText, before);
    assertEquals(result.changes, []);
  }
});

Deno.test("schema-pointer step rewrites each pointer independently and keeps quoting and trailing comments", () => {
  // Given an older quoted $schema key with a trailing comment and a
  // modeline that already names a custom schema
  const olderUrl = configSchemaUrlFor("0.12.0");
  const before = `# yaml-language-server: $schema=./local-schema.json
$schema: "${olderUrl}" # pinned
`;
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });

  // When the step applies
  const result = step.apply({ text: before });

  // Then only the $schema key moves, keeping its quotes and comment
  const currentUrl = configSchemaUrlFor(RUNNING_VERSION);
  assertEquals(
    result.rewrittenText,
    `# yaml-language-server: $schema=./local-schema.json
$schema: "${currentUrl}" # pinned
`,
  );
  assertEquals(
    result.changes.map((change) => change.path),
    [SCHEMA_KEY_CHANGE_PATH],
  );
});

Deno.test("schema-pointer step rewrites both pointers in a CRLF config and keeps its line endings", () => {
  // Given a config with Windows line endings and both pointers outdated
  const olderUrl = configSchemaUrlFor("0.12.0");
  const before = configPointingAt({
    modelineUrl: olderUrl,
    keyUrl: olderUrl,
  }).replaceAll("\n", "\r\n");
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });

  // When the step applies
  const result = step.apply({ text: before });

  // Then both pointers move and every line still ends in CRLF
  const currentUrl = configSchemaUrlFor(RUNNING_VERSION);
  const expected = configPointingAt({
    modelineUrl: currentUrl,
    keyUrl: currentUrl,
  });
  assertEquals(result.rewrittenText, expected.replaceAll("\n", "\r\n"));
  assertEquals(
    result.changes.map((change) => change.path),
    [MODELINE_CHANGE_PATH, SCHEMA_KEY_CHANGE_PATH],
  );
});

Deno.test("schema-pointer step leaves a modeline look-alike inside a block scalar alone", () => {
  // Given an outdated modeline look-alike inside a block scalar, after
  // YAML content has started
  const olderUrl = configSchemaUrlFor("0.12.0");
  const before = `tagging:
  format: "{package}@{version}"
notes: |
  # yaml-language-server: $schema=${olderUrl}
`;
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });

  // When the step applies
  const result = step.apply({ text: before });

  // Then the block scalar's text is untouched
  assertEquals(result.rewrittenText, before);
  assertEquals(result.changes, []);
});

Deno.test("schema-pointer step rewrites only the first modeline of the leading comment block", () => {
  // Given a `---` marker and two outdated modelines in the leading block
  const olderUrl = configSchemaUrlFor("0.12.0");
  const before = `---
# yaml-language-server: $schema=${olderUrl}
# yaml-language-server: $schema=${olderUrl}
tagging: {}
`;
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });

  // When the step applies
  const result = step.apply({ text: before });

  // Then the first one, which is the one dv reads, is the only one moved
  const currentUrl = configSchemaUrlFor(RUNNING_VERSION);
  assertEquals(
    result.rewrittenText,
    `---
# yaml-language-server: $schema=${currentUrl}
# yaml-language-server: $schema=${olderUrl}
tagging: {}
`,
  );
  assertEquals(
    result.changes.map((change) => change.path),
    [MODELINE_CHANGE_PATH],
  );
});

Deno.test("schema-pointer step ignores a nested $schema key", () => {
  // Given an older dv URL under a nested key, which is not the config pointer
  const olderUrl = configSchemaUrlFor("0.12.0");
  const before = `publishing:
  $schema: ${olderUrl}
`;
  const step = createSchemaPointerStep({ runningVersion: RUNNING_VERSION });

  // When the step applies
  const result = step.apply({ text: before });

  // Then it is left alone
  assertEquals(result.rewrittenText, before);
  assertEquals(result.changes, []);
});
