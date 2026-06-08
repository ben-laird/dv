import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { z } from "zod";
import { SCHEMA_URNS } from "../../domain/schema-urns.ts";
import {
  rawInitResultSchema,
  rawMigrateConfigResultSchema,
  rawPluginInvokeResultSchema,
  rawPluginListResultSchema,
  rawPluginVerifyResultSchema,
  rawReleaseResultSchema,
  rawRenameResultSchema,
  rawValidationReportSchema,
} from "./json-contracts.ts";

// Locks the URN ↔ Zod-schema ↔ committed-file correspondence for every
// frozen `--json` envelope. Per-command integration tests assert the live
// output validates; this test guarantees the contract artifacts line up so
// a mismatch can't ship silently.

const ENVELOPES = [
  {
    name: "validation-report",
    urn: SCHEMA_URNS.validationReport,
    schema: rawValidationReportSchema,
    file: "validation-report.json",
  },
  {
    name: "release-result",
    urn: SCHEMA_URNS.releaseResult,
    schema: rawReleaseResultSchema,
    file: "release-result.json",
  },
  {
    name: "rename-result",
    urn: SCHEMA_URNS.renameResult,
    schema: rawRenameResultSchema,
    file: "rename-result.json",
  },
  {
    name: "migrate-config-result",
    urn: SCHEMA_URNS.migrateConfigResult,
    schema: rawMigrateConfigResultSchema,
    file: "migrate-config-result.json",
  },
  {
    name: "init-result",
    urn: SCHEMA_URNS.initResult,
    schema: rawInitResultSchema,
    file: "init-result.json",
  },
  {
    name: "plugin-list-result",
    urn: SCHEMA_URNS.pluginListResult,
    schema: rawPluginListResultSchema,
    file: "plugin-list-result.json",
  },
  {
    name: "plugin-verify-result",
    urn: SCHEMA_URNS.pluginVerifyResult,
    schema: rawPluginVerifyResultSchema,
    file: "plugin-verify-result.json",
  },
  {
    name: "plugin-invoke-result",
    urn: SCHEMA_URNS.pluginInvokeResult,
    schema: rawPluginInvokeResultSchema,
    file: "plugin-invoke-result.json",
  },
] as const;

const REPO_ROOT = resolve(
  new URL(".", import.meta.url).pathname,
  "../../../../..",
);

for (const envelope of ENVELOPES) {
  Deno.test(`${envelope.name}: Zod schema's schema-field const matches the registry URN`, () => {
    // Given the envelope's raw Zod schema
    // When converted to JSON Schema
    const jsonSchema = z.toJSONSchema(envelope.schema, {
      target: "draft-2020-12",
    }) as {
      properties?: { schema?: { const?: unknown } };
    };

    // Then the `schema` field is pinned to the registry URN
    assertEquals(jsonSchema.properties?.schema?.const, envelope.urn);
  });

  Deno.test(`${envelope.name}: committed JSON Schema $id matches the registry URN`, async () => {
    // Given the committed schema file
    const committed = JSON.parse(
      await Deno.readTextFile(
        resolve(REPO_ROOT, "specs/schemas", envelope.file),
      ),
    ) as { $id?: string };

    // Then its $id is the registry URN (drift gate covers the rest)
    assertEquals(committed.$id, envelope.urn);
  });
}
