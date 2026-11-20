import { relative } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { DvError } from "../domain/errors.ts";
import { publishedSchemaUrl } from "../domain/published-schema.ts";
import { SCHEMA_URNS, type SchemaUrns } from "../domain/schema-urns.ts";
import { DV_VERSION } from "../dv-version.ts";
import { configPath, loadConfig, recordsPath } from "../subtools/config/mod.ts";
import {
  diagnoseSchemaPointers,
  readSchemaPointers,
  type SchemaPointerFinding,
  type SchemaPointerKind,
  type SchemaVersionDirection,
} from "../subtools/config/schema-pointer.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import { requireRepoRoot } from "../subtools/git/repo-root.ts";
import type { TracingHooks } from "../subtools/plugin/mod.ts";
import { listRecords, RecordError } from "../subtools/records/mod.ts";
import {
  buildRenameResolver,
  loadRenameLedger,
  renamesPath,
} from "../subtools/renames/mod.ts";
import { makeStderrTracingHooks } from "./debug-trace.ts";

/**
 * `dv validate` per `specs/cli.md` § dv validate.
 *
 * Safe and side-effect-free — runnable in CI as a pre-merge gate. Loads
 * config + discovery + the rename ledger, parses every Record under
 * `.dv/records/`, and aggregates problems (config shape, plugin
 * failures, Record shape, body emptiness, Unresolved References) into
 * one report. Exit code is non-zero iff at least one problem was found.
 */

/** A single problem found by `dv validate`. */
export interface ValidationProblem {
  /** Stable machine-readable problem code. */
  code: string;
  /** Human-readable description of the problem. */
  message: string;
  /** Originating path or identifier (e.g. the offending Record or config), when known. */
  source?: string;
}

/** A non-fatal finding from `dv validate`; never affects `ok` or the exit code. */
export interface ValidationWarning {
  /** Stable machine-readable warning code (an open set). */
  code: string;
  /** Human-readable description of the warning. */
  message: string;
  /** Originating path or identifier, when known. */
  source?: string;
  /** What to do about it. */
  hint: string;
}

/** The `--json` report shape for `dv validate`; one {@link ValidationProblem} per issue. */
export interface ValidationReport {
  /** Versioned schema URN identifying this report shape. */
  schema: SchemaUrns["validationReport"];
  /** `true` iff no problems were found; warnings never affect it. */
  ok: boolean;
  /** Number of Records parsed during the run. */
  recordsChecked: number;
  /** All problems found, empty when `ok`. */
  problems: ValidationProblem[];
  /** Non-fatal findings (see {@link ValidationWarning}). */
  warnings: ValidationWarning[];
}

/** Runtime options controlling a {@link runValidate} call. */
export interface RunValidateOptions {
  /** Emit the {@link ValidationReport} as JSON instead of human-readable output. */
  emitJson: boolean;
  /** Whether ANSI color is enabled for human-readable output. */
  colorEnabled: boolean;
  /** Emit plugin tracing to stderr. */
  debug?: boolean;
}

/** Outcome of a {@link runValidate} call: the {@link ValidationReport} plus a process exit code. */
export interface RunValidateResult {
  /** The aggregated validation report. */
  report: ValidationReport;
  /** Process exit code; non-zero iff problems were found. */
  exitCode: number;
}

/**
 * Run `dv validate`: load config, discovery, and the rename ledger, parse
 * every Record, and aggregate any problems into a {@link RunValidateResult}.
 */
export async function runValidate(
  options: RunValidateOptions,
): Promise<RunValidateResult> {
  const repoRootPath = await requireRepoRoot();
  const validationProblems: ValidationProblem[] = [];
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;

  const loadedConfigOrNull = await tryLoadConfig({
    repoRootPath,
    validationProblems,
  });
  const validationWarnings = loadedConfigOrNull
    ? await readSchemaPointerWarnings({ repoRootPath })
    : [];
  const discoveredPackageNames = loadedConfigOrNull
    ? await tryDiscoverPackages({
        config: loadedConfigOrNull,
        repoRootPath,
        validationProblems,
        tracingHooks,
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
    schema: SCHEMA_URNS.validationReport,
    ok: validationProblems.length === 0,
    recordsChecked: totalRecordsChecked,
    problems: validationProblems,
    warnings: validationWarnings,
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

interface ReadSchemaPointerWarningsArgs {
  repoRootPath: string;
}

type ConfigDocumentRead =
  | { ok: true; text: string; data: unknown }
  | { ok: false };

async function readConfigDocument(
  configFilePath: string,
): Promise<ConfigDocumentRead> {
  try {
    const text = await Deno.readTextFile(configFilePath);
    return { ok: true, text, data: parseYaml(text) };
  } catch {
    return { ok: false };
  }
}

function topLevelSchemaKey(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("$schema" in data)) {
    return undefined;
  }
  return typeof data.$schema === "string" ? data.$schema : undefined;
}

async function readSchemaPointerWarnings(
  args: ReadSchemaPointerWarningsArgs,
): Promise<ValidationWarning[]> {
  const configFilePath = configPath(args.repoRootPath);
  const configDocument = await readConfigDocument(configFilePath);
  if (!configDocument.ok) {
    // The config loaded moments ago; anything wrong with it now is
    // loadConfig's to report, not a schema-pointer finding.
    return [];
  }
  // The key comes from the parsed YAML so every spelling counts; the raw
  // text tells whether it is the block form `dv migrate config` rewrites.
  const rawPointers = readSchemaPointers(configDocument.text);
  const keyUrl = topLevelSchemaKey(configDocument.data);
  const findings = diagnoseSchemaPointers({
    pointers: { modeline: rawPointers.modeline, key: keyUrl },
    runningVersion: DV_VERSION,
  });
  return findings.map((finding) => {
    return schemaPointerWarning({
      finding,
      source: relative(args.repoRootPath, configFilePath),
      keyMigratable: keyUrl !== undefined && rawPointers.key === keyUrl,
    });
  });
}

const POINTER_NAMES: Record<SchemaPointerKind, string> = {
  modeline: "the `# yaml-language-server` modeline",
  key: "the `$schema` key",
};

interface SchemaPointerWarningArgs {
  finding: SchemaPointerFinding;
  source: string;
  /**
   * Whether the `$schema` key is in the block form `$schema: <url>` that
   * `dv migrate config` rewrites (quoted-key or flow forms are not).
   */
  keyMigratable: boolean;
}

/** Turns a schema-pointer finding into a `dv validate` warning. */
export function schemaPointerWarning(
  args: SchemaPointerWarningArgs,
): ValidationWarning {
  const { finding, source } = args;
  const currentUrl = publishedSchemaUrl({
    version: DV_VERSION,
    schema: "config",
  });
  if (finding.kind === "incomplete") {
    const missing = finding.present === "modeline" ? "key" : "modeline";
    return {
      code: "config-schema-pointer-incomplete",
      message: `only ${POINTER_NAMES[finding.present]} points at a schema; ${POINTER_NAMES[missing]} is missing`,
      source,
      hint: `add ${POINTER_NAMES[missing]} with the same URL (${finding.url}); \`dv init\` writes both`,
    };
  }
  const message = `${POINTER_NAMES[finding.pointer]} names the config schema for dv ${finding.pointedVersion}, but this is dv ${DV_VERSION}`;
  return {
    code: "config-schema-version-mismatch",
    message,
    source,
    hint: versionMismatchHint({
      direction: finding.direction,
      pointedVersion: finding.pointedVersion,
      currentUrl,
      migratable: finding.pointer === "modeline" || args.keyMigratable,
    }),
  };
}

interface VersionMismatchHintArgs {
  direction: SchemaVersionDirection;
  pointedVersion: string;
  currentUrl: string;
  migratable: boolean;
}

// `dv migrate config` only moves an older pointer forward, and only the
// modeline or a block-form `$schema: <url>` key.
function versionMismatchHint(args: VersionMismatchHintArgs): string {
  if (args.direction === "older" && args.migratable) {
    return "run `dv migrate config` to point it at this dv release";
  }
  if (args.direction === "older") {
    return `\`dv migrate config\` only rewrites the block form \`$schema: <url>\`; change this one to ${args.currentUrl} by hand`;
  }
  if (args.direction === "newer") {
    return `upgrade dv to ${args.pointedVersion} or later, or point it at ${args.currentUrl}`;
  }
  return `point it at ${args.currentUrl}`;
}

interface TryDiscoverPackagesArgs {
  config: Awaited<ReturnType<typeof loadConfig>>;
  repoRootPath: string;
  validationProblems: ValidationProblem[];
  tracingHooks?: TracingHooks;
}

async function tryDiscoverPackages(
  args: TryDiscoverPackagesArgs,
): Promise<Set<string>> {
  try {
    const discoveredPackages = await discoverPackages({
      config: args.config,
      repoRootPath: args.repoRootPath,
      tracingHooks: args.tracingHooks,
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

  const warningMark = args.colorEnabled ? "\x1b[33m⚠\x1b[39m" : "⚠";
  console.log(
    `${args.report.ok ? checkMark : crossMark} ${validationSummary(args.report)}`,
  );
  for (const reportProblem of args.report.problems) {
    const sourceSuffix = reportProblem.source
      ? ` ${dim(reportProblem.source)}`
      : "";
    console.log(
      `  ${reportProblem.code}: ${reportProblem.message}${sourceSuffix}`,
    );
  }
  for (const reportWarning of args.report.warnings) {
    const sourceSuffix = reportWarning.source
      ? ` ${dim(reportWarning.source)}`
      : "";
    console.log(
      `  ${warningMark} ${reportWarning.code}: ${reportWarning.message}${sourceSuffix}`,
    );
    console.log(`    ${dim(`hint: ${reportWarning.hint}`)}`);
  }
}

const pluralize = (args: { count: number; noun: string }): string => {
  return `${args.count} ${args.noun}${args.count === 1 ? "" : "s"}`;
};

/**
 * The one-line summary of a report: `N records, P problems`, plus
 * `, M warnings` when there are any.
 */
export function validationSummary(report: ValidationReport): string {
  const parts = [
    pluralize({ count: report.recordsChecked, noun: "record" }),
    pluralize({ count: report.problems.length, noun: "problem" }),
  ];
  if (report.warnings.length > 0) {
    parts.push(pluralize({ count: report.warnings.length, noun: "warning" }));
  }
  return parts.join(", ");
}
