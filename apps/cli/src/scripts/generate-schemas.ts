// Generates the JSON Schema artifacts under specs/schemas/ from the Zod
// schemas that live in source. Run via `deno task schemas:generate`.
//
// The CI gate `deno task schemas:check` re-runs this in memory and diffs
// against the committed file; drift fails the build. That gives us the
// docs-and-code lockstep rule (.claude/CLAUDE.md) without anyone having
// to remember to update the JSON by hand.
//
// Output is hand-deterministic: 2-space indentation, trailing newline,
// keys ordered as Zod emits them.

// Zod schema imported from clipc's internal subpath (not the public `.`
// surface — Zod is an implementation detail there). This build script is
// the one sanctioned consumer of the raw schema, feeding it to
// `z.toJSONSchema()` to emit the committed JSON Schema artifact.
import { rawCliErrorEnvelopeSchema } from "@dv-cli/clipc/internal/error-schema";
import { resolve } from "@std/path";
import { z } from "zod";
import {
  rawInitResultSchema,
  rawMigrateConfigResultSchema,
  rawPluginInvokeResultSchema,
  rawPluginListResultSchema,
  rawPluginVerifyResultSchema,
  rawReleaseResultSchema,
  rawRenameResultSchema,
  rawValidationReportSchema,
} from "../cli/schemas/json-contracts.ts";
import {
  assertVersionedSchemaUrns,
  SCHEMA_URNS,
} from "../domain/schema-urns.ts";
import { rawConfigLayerSchema } from "../subtools/config/schema.ts";
import { rawRecordFrontmatterSchema } from "../subtools/records/schema.ts";
import { renameLedgerSchema } from "../subtools/renames/schema.ts";
import { rawPlanSchema } from "../subtools/versioning/plan-schema.ts";

interface GeneratedSchemaFile {
  outputPath: string;
  schema: z.ZodType;
  schemaId: string;
}

const REPO_ROOT = resolveRepoRoot();

// Freeze gate: every registered contract id must carry the versioned
// `urn:dv:schema:vN:` prefix. Throws (failing generate AND check) if not,
// so an unversioned `--json` contract id can't ship.
assertVersionedSchemaUrns();

const schemaFile = (
  fileName: string,
  schema: z.ZodType,
  schemaId: string,
): GeneratedSchemaFile => ({
  outputPath: resolve(REPO_ROOT, "specs/schemas", fileName),
  schema,
  schemaId,
});

const GENERATED_SCHEMA_FILES: GeneratedSchemaFile[] = [
  // Data-file / shared schemas.
  schemaFile("config.json", rawConfigLayerSchema, SCHEMA_URNS.config),
  schemaFile("record.json", rawRecordFrontmatterSchema, SCHEMA_URNS.record),
  schemaFile(
    "rename-ledger.json",
    renameLedgerSchema,
    SCHEMA_URNS.renameLedger,
  ),
  schemaFile("plan.json", rawPlanSchema, SCHEMA_URNS.plan),
  schemaFile("cli-error.json", rawCliErrorEnvelopeSchema, SCHEMA_URNS.cliError),
  // Command `--json` result envelopes (issue #19 freeze).
  schemaFile(
    "validation-report.json",
    rawValidationReportSchema,
    SCHEMA_URNS.validationReport,
  ),
  schemaFile(
    "release-result.json",
    rawReleaseResultSchema,
    SCHEMA_URNS.releaseResult,
  ),
  schemaFile(
    "rename-result.json",
    rawRenameResultSchema,
    SCHEMA_URNS.renameResult,
  ),
  schemaFile(
    "migrate-config-result.json",
    rawMigrateConfigResultSchema,
    SCHEMA_URNS.migrateConfigResult,
  ),
  schemaFile("init-result.json", rawInitResultSchema, SCHEMA_URNS.initResult),
  schemaFile(
    "plugin-list-result.json",
    rawPluginListResultSchema,
    SCHEMA_URNS.pluginListResult,
  ),
  schemaFile(
    "plugin-verify-result.json",
    rawPluginVerifyResultSchema,
    SCHEMA_URNS.pluginVerifyResult,
  ),
  schemaFile(
    "plugin-invoke-result.json",
    rawPluginInvokeResultSchema,
    SCHEMA_URNS.pluginInvokeResult,
  ),
];

interface RenderJsonSchemaArgs {
  schema: z.ZodType;
  schemaId: string;
}

function renderJsonSchema(args: RenderJsonSchemaArgs): string {
  const rendered = z.toJSONSchema(args.schema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;

  // Zod's emit puts $schema first but not $id; both keys are convention
  // for editor schema discovery, so we re-key the object to lead with
  // them in a consistent order.
  const orderedSchema: Record<string, unknown> = {
    $schema: rendered.$schema,
    $id: args.schemaId,
  };
  for (const [key, value] of Object.entries(rendered)) {
    if (key === "$schema") continue;
    orderedSchema[key] = value;
  }
  return `${JSON.stringify(orderedSchema, null, 2)}\n`;
}

interface SchemaCheckResult {
  outputPath: string;
  matches: boolean;
  generated: string;
  committed: string;
}

async function readCommittedSchema(filePath: string): Promise<string> {
  try {
    return await Deno.readTextFile(filePath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) {
      return "";
    }
    throw caughtError;
  }
}

async function generateAll(): Promise<void> {
  for (const fileSpec of GENERATED_SCHEMA_FILES) {
    const generated = renderJsonSchema({
      schema: fileSpec.schema,
      schemaId: fileSpec.schemaId,
    });
    await Deno.writeTextFile(fileSpec.outputPath, generated);
    console.log(`wrote ${relativeToRepo(fileSpec.outputPath)}`);
  }
}

async function checkAll(): Promise<SchemaCheckResult[]> {
  const checkResults: SchemaCheckResult[] = [];
  for (const fileSpec of GENERATED_SCHEMA_FILES) {
    const generated = renderJsonSchema({
      schema: fileSpec.schema,
      schemaId: fileSpec.schemaId,
    });
    const committed = await readCommittedSchema(fileSpec.outputPath);
    checkResults.push({
      outputPath: fileSpec.outputPath,
      matches: committed === generated,
      generated,
      committed,
    });
  }
  return checkResults;
}

function resolveRepoRoot(): string {
  // This script lives at apps/cli/src/scripts/generate-schemas.ts; the
  // repo root is three directories up from src/scripts/.
  return resolve(new URL(".", import.meta.url).pathname, "../../../..");
}

function relativeToRepo(absolutePath: string): string {
  return absolutePath.startsWith(`${REPO_ROOT}/`)
    ? absolutePath.slice(REPO_ROOT.length + 1)
    : absolutePath;
}

async function main(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? "generate";
  switch (subcommand) {
    case "generate":
      await generateAll();
      return 0;
    case "check": {
      const checkResults = await checkAll();
      const driftedResults = checkResults.filter((result) => !result.matches);
      if (driftedResults.length === 0) {
        console.log(
          `schemas in sync (${checkResults.length} file${
            checkResults.length === 1 ? "" : "s"
          })`,
        );
        return 0;
      }
      for (const driftedResult of driftedResults) {
        console.error(
          `drift: ${relativeToRepo(
            driftedResult.outputPath,
          )} is out of sync with the Zod source`,
        );
        console.error(
          `       run \`deno task schemas:generate\` and commit the result`,
        );
      }
      return 1;
    }
    default:
      console.error(
        `usage: generate-schemas.ts [generate|check]   (got: ${subcommand})`,
      );
      return 2;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
