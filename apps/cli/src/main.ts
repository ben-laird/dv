// dv entry point. Dispatches argv to the per-command runner in
// src/cli/. v1 implementation order: see specs/v1-scope.md.

import { parseArgs } from "@std/cli/parse-args";
import { relative } from "@std/path";
import { runInit } from "./cli/init.ts";
import { runStatus } from "./cli/status.ts";
import { DvError } from "./domain/errors.ts";
import { configPath, recordsPath } from "./subtools/config/mod.ts";

const USAGE_TEXT = `dv — language-agnostic, git-native changelog CLI

Usage:
  dv init             Scaffold .changelog/config.yaml and records/ dir
  dv status [--json]  Show what dv would do (read-only)
  dv --help           Show this message
  dv --version        Show the dv version

Milestone 1 ships init + status (discover); the rest of the command set
arrives in later milestones (see specs/v1-scope.md).
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
