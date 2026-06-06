import { DvError } from "../domain/errors.ts";
import { configPath } from "../subtools/config/mod.ts";
import {
  type ConfigMigrationStepResult,
  runConfigMigrations,
} from "../subtools/config-migrations/mod.ts";
import { requireRepoRoot } from "../subtools/git/mod.ts";
import { makeStyler } from "./styler.ts";

/**
 * Inputs to {@link runMigrateConfig}, the `dv migrate config` orchestration
 * per `specs/config-format.md` § Migrating from the pre-1.0 string form.
 */
export interface RunMigrateConfigOptions {
  /** Compute the migration without writing `.dv/config.yaml` back. */
  dryRun: boolean;
  /** Emit a machine-readable JSON summary instead of human output. */
  emitJson: boolean;
  /** Whether to apply ANSI color to human-readable output. */
  colorEnabled: boolean;
}

/**
 * Outcome of {@link runMigrateConfig}: the rewritten `.dv/config.yaml` plus
 * per-step results from the config-migrations registry.
 */
export interface RunMigrateConfigResult {
  /** Absolute path to the `.dv/config.yaml` that was read. */
  configFilePath: string;
  /** `true` when no registered step changed anything (config already current). */
  alreadyMigrated: boolean;
  /** Per-step results in registry order; each records the changes it made. */
  stepResults: ConfigMigrationStepResult[];
  /** `true` when the rewritten text was persisted (never set under `dryRun`). */
  fileWritten: boolean;
}

/**
 * Runs `dv migrate config`: reads `.dv/config.yaml`, applies every registered
 * config-migration step (text-in/text-out so user comments survive), and
 * writes the result back unless `dryRun`. A thin orchestration over the
 * config-migrations subtool, which owns the per-step logic.
 */
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
