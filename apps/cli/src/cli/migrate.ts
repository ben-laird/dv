import { DvError } from "../domain/errors.ts";
import { configPath } from "../subtools/config/mod.ts";
import {
  type ConfigMigrationStepResult,
  runConfigMigrations,
} from "../subtools/config-migrations/mod.ts";
import { requireRepoRoot } from "../subtools/git/mod.ts";
import { makeStyler } from "./styler.ts";

// `dv migrate config` per specs/config-format.md § Migrating from
// the pre-1.0 string form. Reads `.dv/config.yaml`, runs every
// registered migration step from the config-migrations subtool,
// and writes the result back (unless --dry-run). The subtool owns
// the per-step logic; this file is a thin orchestration over it,
// matching the architectural pattern of every other cli/*.ts.
//
// Each future breaking config change ships its own migration step
// in `subtools/config-migrations/step-*.ts`. This command stays
// the single user-facing entrypoint for all of them.

export interface RunMigrateConfigOptions {
  dryRun: boolean;
  emitJson: boolean;
  colorEnabled: boolean;
}

export interface RunMigrateConfigResult {
  configFilePath: string;
  alreadyMigrated: boolean;
  stepResults: ConfigMigrationStepResult[];
  fileWritten: boolean;
}

export async function runMigrateConfig(
  options: RunMigrateConfigOptions,
): Promise<RunMigrateConfigResult> {
  const repoRootPath = await requireRepoRoot();
  const configFilePath = configPath(repoRootPath);

  let originalText: string;
  try {
    originalText = await Deno.readTextFile(configFilePath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) {
      throw new DvError({
        code: "config-not-found",
        message: `config not found: ${configFilePath}`,
        hint: "run `dv init` to scaffold .dv/config.yaml",
        context: { configFilePath },
        cause: caughtError,
      });
    }
    throw caughtError;
  }

  const { rewrittenText, stepResults } = runConfigMigrations({ originalText });
  const totalChanges = stepResults.reduce(
    (runningTotal, stepResult) => runningTotal + stepResult.changes.length,
    0,
  );

  if (totalChanges === 0) {
    if (options.emitJson) {
      console.log(
        JSON.stringify(
          {
            schema: "urn:dv:schema:v1:migrate-config-result",
            configFilePath,
            alreadyMigrated: true,
            stepResults: [],
            fileWritten: false,
          },
          null,
          2,
        ),
      );
    } else {
      const styler = makeStyler(options.colorEnabled);
      console.log("");
      console.log(
        `${styler.dim("nothing to migrate")} — ${styler.cyan(
          configFilePath,
        )} is already in the current shape.`,
      );
      console.log("");
    }
    return {
      configFilePath,
      alreadyMigrated: true,
      stepResults: [],
      fileWritten: false,
    };
  }

  if (options.emitJson) {
    console.log(
      JSON.stringify(
        {
          schema: "urn:dv:schema:v1:migrate-config-result",
          configFilePath,
          alreadyMigrated: false,
          stepResults,
          fileWritten: !options.dryRun,
        },
        null,
        2,
      ),
    );
  } else {
    renderHumanSummary({
      configFilePath,
      stepResults,
      totalChanges,
      dryRun: options.dryRun,
      colorEnabled: options.colorEnabled,
    });
  }

  if (!options.dryRun) {
    await Deno.writeTextFile(configFilePath, rewrittenText);
  }
  return {
    configFilePath,
    alreadyMigrated: false,
    stepResults,
    fileWritten: !options.dryRun,
  };
}

interface RenderHumanSummaryArgs {
  configFilePath: string;
  stepResults: ConfigMigrationStepResult[];
  totalChanges: number;
  dryRun: boolean;
  colorEnabled: boolean;
}

function renderHumanSummary(args: RenderHumanSummaryArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  const titleVerb = args.dryRun
    ? `would migrate ${args.totalChanges}`
    : `migrated ${args.totalChanges}`;
  const changePlural = args.totalChanges === 1 ? "change" : "changes";
  console.log(
    `${styler.green(styler.bold("✓"))} ${titleVerb} ${changePlural} in ${styler.cyan(
      args.configFilePath,
    )}${args.dryRun ? styler.dim(" (dry-run; no file written)") : ""}`,
  );
  for (const stepResult of args.stepResults) {
    console.log("");
    console.log(
      `  ${styler.bold(stepResult.stepId)} — ${styler.dim(stepResult.description)}`,
    );
    for (const change of stepResult.changes) {
      console.log(
        `    ${styler.dim(change.path)}  ${change.before}  →  ${styler.magenta(change.kind)}: ${change.value}`,
      );
    }
  }
  console.log("");
}
