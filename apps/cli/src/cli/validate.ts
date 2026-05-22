import { relative } from "@std/path";
import { DvError } from "../domain/errors.ts";
import { configPath, loadConfig, recordsPath } from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import { requireRepoRoot } from "../subtools/git/repo-root.ts";
import { listRecords, RecordError } from "../subtools/records/mod.ts";
import {
  buildRenameResolver,
  loadRenameLedger,
  renamesPath,
} from "../subtools/renames/mod.ts";

// `dv validate` per specs/cli.md § dv validate.
//
// Safe and side-effect-free — runnable in CI as a pre-merge gate. Loads
// config + discovery + the rename ledger, parses every Record under
// .changelog/records/, and aggregates problems (config shape, plugin
// failures, Record shape, body emptiness, Unresolved References) into
// one report. Exit code is non-zero iff at least one problem was found.

export interface ValidationProblem {
  code: string;
  message: string;
  source?: string;
}

export interface ValidationReport {
  schema: "urn:dv:schema:v1:validation-report";
  ok: boolean;
  recordsChecked: number;
  problems: ValidationProblem[];
}

export interface RunValidateOptions {
  emitJson: boolean;
  colorEnabled: boolean;
}

export interface RunValidateResult {
  report: ValidationReport;
  exitCode: number;
}

export async function runValidate(
  options: RunValidateOptions,
): Promise<RunValidateResult> {
  const repoRootPath = await requireRepoRoot();
  const validationProblems: ValidationProblem[] = [];

  const loadedConfigOrNull = await tryLoadConfig({
    repoRootPath,
    validationProblems,
  });
  const discoveredPackageNames = loadedConfigOrNull
    ? await tryDiscoverPackages({
        config: loadedConfigOrNull,
        repoRootPath,
        validationProblems,
      })
    : new Set<string>();

  const renameLedger = await tryLoadRenameLedger({
    repoRootPath,
    validationProblems,
  });
  let renameResolver: { resolve(packageReference: string): string | undefined };
  try {
    renameResolver = buildRenameResolver({ ledger: renameLedger });
  } catch (caughtError) {
    appendProblem({
      caughtError,
      validationProblems,
      defaultSource: renamesPath(repoRootPath),
    });
    renameResolver = { resolve: (packageReference) => packageReference };
  }

  const recordsListing = await listRecords({
    recordsDirectory: recordsPath(repoRootPath),
  });
  for (const failedRecord of recordsListing.failures) {
    validationProblems.push({
      code: failedRecord.kind.code,
      message: failedRecord.message,
      source: relative(repoRootPath, failedRecord.recordPath),
    });
  }

  for (const parsedRecord of recordsListing.parsedRecords) {
    for (const packageReference of parsedRecord.packages) {
      const resolvedReference =
        renameResolver.resolve(packageReference) ?? packageReference;
      if (!discoveredPackageNames.has(resolvedReference)) {
        validationProblems.push({
          code: "unresolved-reference",
          message:
            `record references unknown package '${packageReference}'` +
            (resolvedReference !== packageReference
              ? ` (resolved through renames to '${resolvedReference}')`
              : ""),
          source: parsedRecord.filename,
        });
      }
    }
  }

  const totalRecordsChecked =
    recordsListing.parsedRecords.length + recordsListing.failures.length;
  const validationReport: ValidationReport = {
    schema: "urn:dv:schema:v1:validation-report",
    ok: validationProblems.length === 0,
    recordsChecked: totalRecordsChecked,
    problems: validationProblems,
  };

  if (options.emitJson) {
    console.log(JSON.stringify(validationReport, null, 2));
  } else {
    renderHumanReport({
      report: validationReport,
      colorEnabled: options.colorEnabled,
    });
  }

  return {
    report: validationReport,
    exitCode: validationReport.ok ? 0 : 1,
  };
}

interface TryLoadConfigArgs {
  repoRootPath: string;
  validationProblems: ValidationProblem[];
}

async function tryLoadConfig(
  args: TryLoadConfigArgs,
): Promise<Awaited<ReturnType<typeof loadConfig>> | null> {
  try {
    return await loadConfig(configPath(args.repoRootPath));
  } catch (caughtError) {
    appendProblem({
      caughtError,
      validationProblems: args.validationProblems,
      defaultSource: configPath(args.repoRootPath),
    });
    return null;
  }
}

interface TryDiscoverPackagesArgs {
  config: Awaited<ReturnType<typeof loadConfig>>;
  repoRootPath: string;
  validationProblems: ValidationProblem[];
}

async function tryDiscoverPackages(
  args: TryDiscoverPackagesArgs,
): Promise<Set<string>> {
  try {
    const discoveredPackages = await discoverPackages({
      config: args.config,
      repoRootPath: args.repoRootPath,
    });
    return new Set(discoveredPackages.map((discovered) => discovered.name));
  } catch (caughtError) {
    appendProblem({
      caughtError,
      validationProblems: args.validationProblems,
      defaultSource: configPath(args.repoRootPath),
    });
    return new Set<string>();
  }
}

interface TryLoadRenameLedgerArgs {
  repoRootPath: string;
  validationProblems: ValidationProblem[];
}

async function tryLoadRenameLedger(
  args: TryLoadRenameLedgerArgs,
): Promise<Awaited<ReturnType<typeof loadRenameLedger>>> {
  try {
    return await loadRenameLedger({
      ledgerPath: renamesPath(args.repoRootPath),
    });
  } catch (caughtError) {
    appendProblem({
      caughtError,
      validationProblems: args.validationProblems,
      defaultSource: renamesPath(args.repoRootPath),
    });
    return [];
  }
}

interface AppendProblemArgs {
  caughtError: unknown;
  validationProblems: ValidationProblem[];
  defaultSource: string;
}

function appendProblem(args: AppendProblemArgs): void {
  if (args.caughtError instanceof RecordError) {
    args.validationProblems.push({
      code: args.caughtError.kind.code,
      message: args.caughtError.message,
      source: args.caughtError.recordPath,
    });
    return;
  }
  if (args.caughtError instanceof DvError) {
    args.validationProblems.push({
      code: args.caughtError.kind.code,
      message: args.caughtError.message,
      source: args.defaultSource,
    });
    return;
  }
  const fallbackMessage =
    args.caughtError instanceof Error
      ? args.caughtError.message
      : String(args.caughtError);
  args.validationProblems.push({
    code: "validate-unknown",
    message: fallbackMessage,
    source: args.defaultSource,
  });
}

interface RenderHumanReportArgs {
  report: ValidationReport;
  colorEnabled: boolean;
}

function renderHumanReport(args: RenderHumanReportArgs): void {
  const checkMark = args.colorEnabled ? "\x1b[32m✓\x1b[39m" : "✓";
  const crossMark = args.colorEnabled ? "\x1b[31m✗\x1b[39m" : "✗";
  const dim = (text: string) =>
    args.colorEnabled ? `\x1b[2m${text}\x1b[22m` : text;

  if (args.report.ok) {
    console.log(
      `${checkMark} ${args.report.recordsChecked} record${
        args.report.recordsChecked === 1 ? "" : "s"
      }, 0 problems`,
    );
    return;
  }

  console.log(
    `${crossMark} ${args.report.recordsChecked} record${
      args.report.recordsChecked === 1 ? "" : "s"
    }, ${args.report.problems.length} problem${
      args.report.problems.length === 1 ? "" : "s"
    }`,
  );
  for (const reportProblem of args.report.problems) {
    const sourceSuffix = reportProblem.source
      ? ` ${dim(reportProblem.source)}`
      : "";
    console.log(
      `  ${reportProblem.code}: ${reportProblem.message}${sourceSuffix}`,
    );
  }
}
