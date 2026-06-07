import { z } from "zod";
import { SCHEMA_URNS } from "../../domain/schema-urns.ts";
import { rawPlanSchema } from "../../subtools/versioning/plan-schema.ts";

// Zod sources for every `dv` command `--json` result envelope. These feed
// `z.toJSONSchema()` in the schema generator (specs/schemas/*-result.json)
// and back the contract-conformance tests that assert each command's
// emitted output validates against its schema.
//
// IMPORTANT: each schema must mirror exactly what the command EMITS under
// `--json` — which is sometimes a projection of the in-memory Run*Result
// (nullable fields where the command writes `?? null`, extra fields like
// `dryRun`). The committed schema, not the TS interface, is the frozen
// contract; the conformance tests keep them aligned.
//
// `.strict()` everywhere: an undeclared field in a frozen payload is a
// contract break we want the drift gate to catch.

const schemaUrnLiteral = (urn: string) =>
  z.literal(urn).describe("Versioned schema URN identifying this payload.");

// === validate =====================================================

const validationProblemSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    source: z.string().optional(),
  })
  .strict();

export const rawValidationReportSchema = z
  .object({
    schema: schemaUrnLiteral(SCHEMA_URNS.validationReport),
    ok: z.boolean(),
    recordsChecked: z.number().int(),
    problems: z.array(validationProblemSchema),
  })
  .strict()
  .meta({
    title: "Validation report",
    description: "The `dv validate --json` report: ok flag + problems.",
  });

// === release ======================================================

const releaseOpOutcomeSchema = z
  .object({
    package: z.string(),
    tag: z.string(),
    ok: z.boolean(),
    published: z.boolean().optional(),
    skipped: z.boolean().optional(),
    message: z.string().optional(),
  })
  .strict();

export const rawReleaseResultSchema = z
  .object({
    schema: schemaUrnLiteral(SCHEMA_URNS.releaseResult),
    plan: rawPlanSchema,
    mintedTagNames: z.array(z.string()),
    reusedTagNames: z.array(z.string()),
    releaseOpOutcomes: z.array(releaseOpOutcomeSchema),
    pushedTagNames: z.array(z.string()),
  })
  .strict()
  .meta({
    title: "Release result",
    description:
      "The `dv release --json` envelope: the executed Plan plus minted/reused/pushed tags and per-Package release-op outcomes.",
  });

// === rename =======================================================

export const rawRenameResultSchema = z
  .object({
    schema: schemaUrnLiteral(SCHEMA_URNS.renameResult),
    ledgerPath: z.string(),
    fromPackageName: z.string(),
    toPackageName: z.string(),
    atVersion: z.string(),
    atVersionSource: z.enum(["inferred", "override"]),
    fileCreated: z.boolean(),
    fileWritten: z.boolean(),
    dryRun: z.boolean(),
  })
  .strict()
  .meta({
    title: "Rename result",
    description:
      "The `dv rename --json` envelope: the appended lineage edge and what changed on disk.",
  });

// === migrate config ===============================================

const migrationChangeSchema = z
  .object({
    path: z.string(),
    before: z.string(),
    kind: z.string(),
    value: z.string(),
  })
  .strict();

const configMigrationStepResultSchema = z
  .object({
    stepId: z.string(),
    description: z.string(),
    changes: z.array(migrationChangeSchema),
  })
  .strict();

export const rawMigrateConfigResultSchema = z
  .object({
    schema: schemaUrnLiteral(SCHEMA_URNS.migrateConfigResult),
    configFilePath: z.string(),
    alreadyMigrated: z.boolean(),
    stepResults: z.array(configMigrationStepResultSchema),
    fileWritten: z.boolean(),
  })
  .strict()
  .meta({
    title: "Migrate-config result",
    description:
      "The `dv migrate config --json` envelope: per-step config-migration changes and whether the file was rewritten.",
  });

// === init =========================================================

export const rawInitResultSchema = z
  .object({
    schema: schemaUrnLiteral(SCHEMA_URNS.initResult),
    repoRoot: z.string(),
    alreadyInitialized: z.boolean(),
    created: z
      .object({
        config: z.string().nullable(),
        recordsDir: z.string().nullable(),
        gitignore: z.string().nullable(),
      })
      .strict(),
  })
  .strict()
  .meta({
    title: "Init result",
    description:
      "The `dv init --json` envelope: which `.dv/` artifacts were created (null when already present).",
  });

// === plugin list ==================================================

const pluginListPackageSchema = z
  .object({
    name: z.string(),
    path: z.string(),
  })
  .strict();

const pluginListEntrySchema = z
  .object({
    assignmentIndex: z.number().int(),
    pluginReferenceKey: z.string(),
    matchGlobs: z.array(z.string()),
    status: z.enum(["ok", "resolve-failed", "discover-failed"]),
    resolvedPluginPath: z.string().nullable(),
    resolvedPluginKind: z.string().nullable(),
    packages: z.array(pluginListPackageSchema),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
  })
  .strict();

export const rawPluginListResultSchema = z
  .object({
    schema: schemaUrnLiteral(SCHEMA_URNS.pluginListResult),
    repoRootPath: z.string(),
    entries: z.array(pluginListEntrySchema),
    hasFailures: z.boolean(),
  })
  .strict()
  .meta({
    title: "Plugin-list result",
    description:
      "The `dv plugin list --json` audit: one entry per config plugin assignment with the Packages it claims.",
  });

// === plugin verify ================================================

const checkReportSchema = z
  .object({
    name: z.string(),
    outcome: z.enum(["pass", "fail", "skipped"]),
    detail: z.string(),
  })
  .strict();

export const rawPluginVerifyResultSchema = z
  .object({
    schema: schemaUrnLiteral(SCHEMA_URNS.pluginVerifyResult),
    pluginPath: z.string(),
    checks: z.array(checkReportSchema),
    summary: z
      .object({
        passedCount: z.number().int(),
        failedCount: z.number().int(),
        skippedCount: z.number().int(),
      })
      .strict(),
  })
  .strict()
  .meta({
    title: "Plugin-verify result",
    description:
      "The `dv plugin verify --json` conformance report: per-Op checks plus a pass/fail/skip summary.",
  });

// === plugin invoke ================================================

export const rawPluginInvokeResultSchema = z
  .object({
    schema: schemaUrnLiteral(SCHEMA_URNS.pluginInvokeResult),
    pluginPath: z.string(),
    opName: z.string(),
    environmentVariables: z.record(z.string(), z.string()),
    stdinPayload: z.string().nullable(),
    rawStdout: z.string(),
    rawStderr: z.string(),
    // The parsed plugin response is Op-shaped (validated elsewhere against
    // the per-Op response schemas); the envelope only guarantees it's
    // present, so we leave it unconstrained here.
    parsedResponse: z.unknown(),
    conformant: z.boolean(),
  })
  .strict()
  .meta({
    title: "Plugin-invoke result",
    description:
      "The `dv plugin invoke --json` exchange: the full stdio round-trip and the conformance verdict.",
  });
