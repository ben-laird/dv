// dv entry point. Subcommands are CommandSpec objects passed to
// `defineCli` from @seshat/cli; this file is glue, not dispatch.

import { defineCli, defineCommand } from "@seshat/cli";
import { relative } from "@std/path";
import { runAdd } from "./cli/add.ts";
import { runInit } from "./cli/init.ts";
import { runRelease } from "./cli/release.ts";
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
  dv release [--dry-run --push --yes]  Mint per-Package tags + fire release plugins
  dv --help                            Show this message
  dv --version                         Show the dv version

Milestones 1–3 are landing; the rest of v1 follows specs/v1-scope.md.
`;

const DV_VERSION = "0.1.0";

const initCommand = defineCommand({
  flags: {},
  usage: "Usage: dv init",
  run: async ({ argv }) => {
    if (argv.length > 0) {
      console.error(`dv init: unexpected arguments: ${argv.join(" ")}`);
      return 2;
    }
    const initResult = await runInit();
    if (
      !initResult.configCreated &&
      !initResult.recordsDirCreated &&
      !initResult.gitignoreCreated
    ) {
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
    if (initResult.gitignoreCreated) {
      console.log("created .changelog/.gitignore");
    }
    return 0;
  },
});

const statusCommand = defineCommand({
  flags: {
    json: { kind: "boolean" },
    color: { kind: "boolean" },
    "no-color": { kind: "boolean" },
  },
  usage: "Usage: dv status [--json] [--no-color]",
  run: async ({ flags }) => {
    const colorEnabled = resolveColorEnabled({
      forceColor: flags.color === true,
      suppressColor: flags["no-color"] === true,
      emitJson: flags.json === true,
    });
    await runStatus({ emitJson: flags.json === true, colorEnabled });
    return 0;
  },
});

const addCommand = defineCommand({
  flags: {
    type: { kind: "string" },
    message: { kind: "string" },
    notes: { kind: "string" },
    packages: { kind: "collect" },
    links: { kind: "collect" },
    stage: { kind: "boolean" },
    "no-stage": { kind: "boolean" },
    editor: { kind: "string" },
  },
  usage:
    "Usage: dv add [--type <t>] [--packages <p>...] [--message <m>] [--links <url>...] [--notes <text>] [--stage | --no-stage] [--editor <cmd>]",
  run: async ({ flags }) => {
    const rawChangeType = flags.type;
    if (rawChangeType !== undefined && !isChangeType(rawChangeType)) {
      console.error(
        `dv add: --type must be one of ${CHANGE_TYPES.join(", ")} (got '${rawChangeType}')`,
      );
      return 2;
    }
    const packageNames = expandCommaSeparated(flags.packages);
    const links = expandCommaSeparated(flags.links);
    const stageOverride =
      flags["no-stage"] === true
        ? false
        : flags.stage === true
          ? true
          : undefined;

    const addResult = await runAdd({
      changeType: rawChangeType,
      packageNames,
      message: flags.message,
      links,
      notes: flags.notes,
      stageOverride,
      editorOverride: flags.editor,
    });
    const relativeRecordPath = relative(
      addResult.repoRootPath,
      addResult.recordPath,
    );
    console.log(
      `created ${relativeRecordPath}${addResult.staged ? " (staged)" : ""}`,
    );
    return 0;
  },
});

const validateCommand = defineCommand({
  flags: {
    json: { kind: "boolean" },
    color: { kind: "boolean" },
    "no-color": { kind: "boolean" },
  },
  usage: "Usage: dv validate [--json] [--no-color]",
  run: async ({ flags }) => {
    const colorEnabled = resolveColorEnabled({
      forceColor: flags.color === true,
      suppressColor: flags["no-color"] === true,
      emitJson: flags.json === true,
    });
    const validateResult = await runValidate({
      emitJson: flags.json === true,
      colorEnabled,
    });
    return validateResult.exitCode;
  },
});

const versionCommand = defineCommand({
  flags: {
    "dry-run": { kind: "boolean" },
    "no-dry-run": { kind: "boolean" },
    "no-commit": { kind: "boolean" },
    prune: { kind: "boolean" },
    yes: { kind: "boolean", alias: "y" },
    json: { kind: "boolean" },
    color: { kind: "boolean" },
    "no-color": { kind: "boolean" },
  },
  usage:
    "Usage: dv version [--dry-run] [--no-commit] [--prune] [--yes] [--json]",
  run: async ({ flags }) => {
    const dryRunOverride =
      flags["no-dry-run"] === true
        ? false
        : flags["dry-run"] === true
          ? true
          : undefined;
    const colorEnabled = resolveColorEnabled({
      forceColor: flags.color === true,
      suppressColor: flags["no-color"] === true,
      emitJson: flags.json === true,
    });
    await runVersion({
      dryRun: dryRunOverride,
      noCommit: flags["no-commit"] === true,
      prune: flags.prune === true,
      emitJson: flags.json === true,
      colorEnabled,
      yes: flags.yes === true,
    });
    return 0;
  },
});

const releaseCommand = defineCommand({
  flags: {
    "dry-run": { kind: "boolean" },
    "no-dry-run": { kind: "boolean" },
    force: { kind: "boolean" },
    push: { kind: "boolean" },
    "no-push": { kind: "boolean" },
    yes: { kind: "boolean", alias: "y" },
    json: { kind: "boolean" },
    color: { kind: "boolean" },
    "no-color": { kind: "boolean" },
  },
  usage:
    "Usage: dv release [--dry-run] [--force] [--push | --no-push] [--yes] [--json]",
  run: async ({ flags }) => {
    const dryRunOverride =
      flags["no-dry-run"] === true
        ? false
        : flags["dry-run"] === true
          ? true
          : undefined;
    const pushOverride =
      flags["no-push"] === true
        ? false
        : flags.push === true
          ? true
          : undefined;
    const colorEnabled = resolveColorEnabled({
      forceColor: flags.color === true,
      suppressColor: flags["no-color"] === true,
      emitJson: flags.json === true,
    });
    const result = await runRelease({
      dryRun: dryRunOverride,
      force: flags.force === true,
      push: pushOverride,
      yes: flags.yes === true,
      emitJson: flags.json === true,
      colorEnabled,
    });
    // Non-zero exit when any release Op failed (push failures throw
    // and surface through the framework's reportError hook).
    const hasFailures = result.releaseOpOutcomes.some((outcome) => !outcome.ok);
    return hasFailures ? 1 : 0;
  },
});

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

function reportDvError(
  caughtError: unknown,
  _ctx: { mode: "human" | "json" },
): void {
  // EC7 will route through @seshat/cli's renderCliError for proper
  // human-vs-JSON output. For now keep the minimal `dv: <message>`
  // line so the framework's wrapped CliError still surfaces something
  // useful.
  if (caughtError instanceof DvError) {
    console.error(`dv: ${caughtError.message}`);
    return;
  }
  if (caughtError instanceof Error) {
    console.error(`dv: ${caughtError.message}`);
    return;
  }
  console.error(`dv: ${String(caughtError)}`);
}

const cli = defineCli({
  name: "dv",
  version: DV_VERSION,
  usage: USAGE_TEXT,
  commands: {
    init: initCommand,
    status: statusCommand,
    add: addCommand,
    validate: validateCommand,
    version: versionCommand,
    release: releaseCommand,
  },
  reportError: reportDvError,
});

export function main(argv: string[]): Promise<number> {
  return cli.run(argv);
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
