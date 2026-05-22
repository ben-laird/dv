// dv entry point. Dispatches argv to the per-command runner in
// src/cli/. v1 implementation order: see specs/v1-scope.md.

import { parseArgs } from "@std/cli/parse-args";
import { relative } from "@std/path";
import { runAdd } from "./cli/add.ts";
import { runInit } from "./cli/init.ts";
import { runStatus } from "./cli/status.ts";
import { runValidate } from "./cli/validate.ts";
import { runVersion } from "./cli/version.ts";
import { CHANGE_TYPES, isChangeType } from "./domain/change-type.ts";
import { DvError } from "./domain/errors.ts";
import { configPath, recordsPath } from "./subtools/config/mod.ts";

const USAGE_TEXT = `dv — language-agnostic, git-native changelog CLI

Usage:
  dv init                              Scaffold .changelog/config.yaml + records/
  dv status [--json]                   Show what dv would do (read-only)
  dv add [--type T --packages P …]     File a Record (interactive or flag-driven)
  dv validate [--json]                 Lint records and config (CI-friendly)
  dv version [--dry-run --prune …]     Consume Records → bump, CHANGELOG, commit
  dv --help                            Show this message
  dv --version                         Show the dv version

Milestones 1–3 are landing; the rest of v1 follows specs/v1-scope.md.
`;

const DV_VERSION = "0.0.0";

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE_TEXT);
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    console.log(DV_VERSION);
    return 0;
  }

  const [subcommandName, ...subcommandArgv] = argv;
  try {
    switch (subcommandName) {
      case "init":
        return await runInitCommand(subcommandArgv);
      case "status":
        return await runStatusCommand(subcommandArgv);
      case "add":
        return await runAddCommand(subcommandArgv);
      case "validate":
        return await runValidateCommand(subcommandArgv);
      case "version":
        return await runVersionCommand(subcommandArgv);
      default:
        console.error(`dv: unknown command '${subcommandName}'`);
        console.error(`run 'dv --help' for usage`);
        return 2;
    }
  } catch (caughtError) {
    return reportError(caughtError);
  }
}

async function runInitCommand(subcommandArgv: string[]): Promise<number> {
  if (subcommandArgv.length > 0) {
    console.error(`dv init: unexpected arguments: ${subcommandArgv.join(" ")}`);
    return 2;
  }
  const initResult = await runInit();
  if (!initResult.configCreated && !initResult.recordsDirCreated) {
    console.log("dv: already initialized");
    return 0;
  }
  if (initResult.configCreated) {
    console.log(
      `created ${relative(
        initResult.repoRoot,
        configPath(initResult.repoRoot),
      )}`,
    );
  }
  if (initResult.recordsDirCreated) {
    console.log(
      `created ${relative(
        initResult.repoRoot,
        recordsPath(initResult.repoRoot),
      )}/`,
    );
  }
  return 0;
}

async function runStatusCommand(subcommandArgv: string[]): Promise<number> {
  const parsedFlags = parseArgs(subcommandArgv, {
    boolean: ["json", "help", "color", "no-color"],
    alias: { h: "help" },
    unknown: (flagName) => {
      if (flagName.startsWith("-")) {
        console.error(`dv status: unknown flag '${flagName}'`);
        Deno.exit(2);
      }
      return true;
    },
  });
  if (parsedFlags.help) {
    console.log("Usage: dv status [--json] [--no-color]");
    return 0;
  }
  const colorEnabled = resolveColorEnabled({
    forceColor: parsedFlags.color === true,
    suppressColor: parsedFlags["no-color"] === true,
    emitJson: parsedFlags.json === true,
  });
  await runStatus({ emitJson: parsedFlags.json, colorEnabled });
  return 0;
}

async function runAddCommand(subcommandArgv: string[]): Promise<number> {
  const parsedFlags = parseArgs(subcommandArgv, {
    string: ["type", "message", "notes"],
    collect: ["packages", "links"],
    boolean: ["stage", "no-stage", "help"],
    alias: { h: "help" },
    unknown: (flagName) => {
      if (flagName.startsWith("-")) {
        console.error(`dv add: unknown flag '${flagName}'`);
        Deno.exit(2);
      }
      return true;
    },
  });
  if (parsedFlags.help) {
    console.log(
      "Usage: dv add [--type <t>] [--packages <p>...] [--message <m>] [--links <url>...] [--notes <text>] [--stage | --no-stage]",
    );
    return 0;
  }

  const rawChangeType = parsedFlags.type;
  if (rawChangeType !== undefined && !isChangeType(rawChangeType)) {
    console.error(
      `dv add: --type must be one of ${CHANGE_TYPES.join(", ")} (got '${rawChangeType}')`,
    );
    return 2;
  }

  const packageNames = expandCommaSeparated(
    parsedFlags.packages as string[] | undefined,
  );
  const links = expandCommaSeparated(parsedFlags.links as string[] | undefined);

  const stageOverride =
    parsedFlags["no-stage"] === true
      ? false
      : parsedFlags.stage === true
        ? true
        : undefined;

  const addResult = await runAdd({
    changeType: rawChangeType,
    packageNames,
    message: parsedFlags.message,
    links,
    notes: parsedFlags.notes,
    stageOverride,
  });

  const relativeRecordPath = relative(
    addResult.repoRootPath,
    addResult.recordPath,
  );
  console.log(
    `created ${relativeRecordPath}${addResult.staged ? " (staged)" : ""}`,
  );
  return 0;
}

async function runValidateCommand(subcommandArgv: string[]): Promise<number> {
  const parsedFlags = parseArgs(subcommandArgv, {
    boolean: ["json", "help", "color", "no-color"],
    alias: { h: "help" },
    unknown: (flagName) => {
      if (flagName.startsWith("-")) {
        console.error(`dv validate: unknown flag '${flagName}'`);
        Deno.exit(2);
      }
      return true;
    },
  });
  if (parsedFlags.help) {
    console.log("Usage: dv validate [--json] [--no-color]");
    return 0;
  }
  const colorEnabled = resolveColorEnabled({
    forceColor: parsedFlags.color === true,
    suppressColor: parsedFlags["no-color"] === true,
    emitJson: parsedFlags.json === true,
  });
  const validateResult = await runValidate({
    emitJson: parsedFlags.json,
    colorEnabled,
  });
  return validateResult.exitCode;
}

async function runVersionCommand(subcommandArgv: string[]): Promise<number> {
  const parsedFlags = parseArgs(subcommandArgv, {
    boolean: [
      "dry-run",
      "no-dry-run",
      "no-commit",
      "prune",
      "yes",
      "json",
      "color",
      "no-color",
      "help",
    ],
    alias: { h: "help", y: "yes" },
    unknown: (flagName) => {
      if (flagName.startsWith("-")) {
        console.error(`dv version: unknown flag '${flagName}'`);
        Deno.exit(2);
      }
      return true;
    },
  });
  if (parsedFlags.help) {
    console.log(
      "Usage: dv version [--dry-run] [--no-commit] [--prune] [--yes] [--json]",
    );
    return 0;
  }
  const dryRunOverride =
    parsedFlags["no-dry-run"] === true
      ? false
      : parsedFlags["dry-run"] === true
        ? true
        : undefined;
  const colorEnabled = resolveColorEnabled({
    forceColor: parsedFlags.color === true,
    suppressColor: parsedFlags["no-color"] === true,
    emitJson: parsedFlags.json === true,
  });
  await runVersion({
    dryRun: dryRunOverride,
    noCommit: parsedFlags["no-commit"] === true,
    prune: parsedFlags.prune === true,
    emitJson: parsedFlags.json === true,
    colorEnabled,
    yes: parsedFlags.yes === true,
  });
  return 0;
}

function expandCommaSeparated(
  rawValues: string[] | undefined,
): string[] | undefined {
  if (rawValues === undefined) return undefined;
  const expanded: string[] = [];
  for (const rawValue of rawValues) {
    for (const part of rawValue.split(",")) {
      const trimmedPart = part.trim();
      if (trimmedPart.length > 0) expanded.push(trimmedPart);
    }
  }
  return expanded.length > 0 ? expanded : undefined;
}

interface ResolveColorEnabledArgs {
  forceColor: boolean;
  suppressColor: boolean;
  emitJson: boolean;
}

function resolveColorEnabled(args: ResolveColorEnabledArgs): boolean {
  if (args.emitJson) return false;
  if (args.suppressColor) return false;
  if (args.forceColor) return true;
  if (Deno.env.get("NO_COLOR")) return false;
  return Deno.stdout.isTerminal();
}

function reportError(caughtError: unknown): number {
  if (caughtError instanceof DvError) {
    console.error(`dv: ${caughtError.message}`);
    return 1;
  }
  if (caughtError instanceof Error) {
    console.error(`dv: ${caughtError.message}`);
    return 1;
  }
  console.error(`dv: ${String(caughtError)}`);
  return 1;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
