// dv entry point. Subcommands are CommandSpec objects passed to
// `defineCli` from @seshat/cli; this file is glue, not dispatch.

import {
  CliError,
  defineCli,
  defineCommand,
  type ReportErrorContext,
  renderCliError,
} from "@seshat/cli";
import { join, relative } from "@std/path";
import { runAdd } from "./cli/add.ts";
import { runInit } from "./cli/init.ts";
import { runRelease } from "./cli/release.ts";
import { runStatus } from "./cli/status.ts";
import { runV1 } from "./cli/v1.ts";
import { runValidate } from "./cli/validate.ts";
import { runVersion } from "./cli/version.ts";
import { CHANGE_TYPES, isChangeType } from "./domain/change-type.ts";
import { DV_VERSION } from "./dv-version.ts";
import { CONFIG_DIR, configPath, recordsPath } from "./subtools/config/mod.ts";

const USAGE_TEXT = `dv — language-agnostic, git-native changelog CLI

Usage:
  dv init                              Scaffold .dv/config.yaml + records/
  dv status [--json]                   Show what dv would do (read-only)
  dv add [--type T --packages P …]     File a Record (interactive or flag-driven)
  dv validate [--json]                 Lint records and config (CI-friendly)
  dv version [--dry-run --prune …]     Consume Records → bump, CHANGELOG, commit
  dv release [--dry-run --push --yes]  Mint per-Package tags + fire release plugins
  dv v1 <package> [--yes …]            Promote a 0.x Package to 1.0.0 (the stability promise)
  dv --help                            Show this message
  dv --version                         Show the dv version

Milestones 1–3 are landing; the rest of v1 follows specs/v1-scope.md.
`;

const initCommand = defineCommand({
  flags: {
    json: { kind: "boolean" },
  },
  usage: "Usage: dv init [--json]",
  run: async ({ argv, flags }) => {
    if (argv.length > 0) {
      console.error(`dv init: unexpected arguments: ${argv.join(" ")}`);
      return 2;
    }
    const initResult = await runInit();
    if (flags.json === true) {
      // Structured success envelope — symmetric with the cli-error
      // envelope so scripted scaffolding flows can read `created`
      // vs `alreadyInitialized` directly without parsing stdout text.
      const configRelative = relative(
        initResult.repoRoot,
        configPath(initResult.repoRoot),
      );
      const recordsRelative = `${relative(
        initResult.repoRoot,
        recordsPath(initResult.repoRoot),
      )}/`;
      const gitignoreRelative = relative(
        initResult.repoRoot,
        join(initResult.repoRoot, CONFIG_DIR, ".gitignore"),
      );
      const wasAlreadyInitialized =
        !initResult.configCreated &&
        !initResult.recordsDirCreated &&
        !initResult.gitignoreCreated;
      console.log(
        JSON.stringify(
          {
            schema: "urn:dv:schema:v1:init-result",
            repoRoot: initResult.repoRoot,
            alreadyInitialized: wasAlreadyInitialized,
            created: {
              config: initResult.configCreated ? configRelative : null,
              recordsDir: initResult.recordsDirCreated ? recordsRelative : null,
              gitignore: initResult.gitignoreCreated ? gitignoreRelative : null,
            },
          },
          null,
          2,
        ),
      );
      return 0;
    }
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
      console.log(`created ${CONFIG_DIR}/.gitignore`);
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
    "allow-dirty": { kind: "boolean" },
    "no-allow-dirty": { kind: "boolean" },
    json: { kind: "boolean" },
    color: { kind: "boolean" },
    "no-color": { kind: "boolean" },
  },
  usage:
    "Usage: dv version [--dry-run] [--no-commit] [--prune] [--yes] [--allow-dirty] [--json]",
  run: async ({ flags }) => {
    const dryRunOverride =
      flags["no-dry-run"] === true
        ? false
        : flags["dry-run"] === true
          ? true
          : undefined;
    const allowDirtyOverride =
      flags["no-allow-dirty"] === true
        ? false
        : flags["allow-dirty"] === true
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
      allowDirty: allowDirtyOverride,
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
    "allow-dirty": { kind: "boolean" },
    "no-allow-dirty": { kind: "boolean" },
    json: { kind: "boolean" },
    color: { kind: "boolean" },
    "no-color": { kind: "boolean" },
  },
  usage:
    "Usage: dv release [--dry-run] [--force] [--push | --no-push] [--yes] [--allow-dirty] [--json]",
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
    const allowDirtyOverride =
      flags["no-allow-dirty"] === true
        ? false
        : flags["allow-dirty"] === true
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
      allowDirty: allowDirtyOverride,
    });
    // Non-zero exit when any release Op failed (push failures throw
    // and surface through the framework's reportError hook).
    const hasFailures = result.releaseOpOutcomes.some((outcome) => !outcome.ok);
    return hasFailures ? 1 : 0;
  },
});

const v1Command = defineCommand({
  flags: {
    "dry-run": { kind: "boolean" },
    "no-dry-run": { kind: "boolean" },
    "no-commit": { kind: "boolean" },
    prune: { kind: "boolean" },
    yes: { kind: "boolean", alias: "y" },
    "allow-dirty": { kind: "boolean" },
    "no-allow-dirty": { kind: "boolean" },
    json: { kind: "boolean" },
    color: { kind: "boolean" },
    "no-color": { kind: "boolean" },
  },
  usage:
    "Usage: dv v1 <package> [--dry-run] [--no-commit] [--prune] [--yes] [--allow-dirty] [--json]",
  run: async ({ argv, flags }) => {
    if (argv.length !== 1) {
      console.error(
        `dv v1: expected exactly one <package> argument; got ${argv.length}`,
      );
      console.error("run 'dv v1 --help' for usage");
      return 2;
    }
    const packageName = argv[0] ?? "";
    const dryRunOverride =
      flags["no-dry-run"] === true
        ? false
        : flags["dry-run"] === true
          ? true
          : undefined;
    const allowDirtyOverride =
      flags["no-allow-dirty"] === true
        ? false
        : flags["allow-dirty"] === true
          ? true
          : undefined;
    const colorEnabled = resolveColorEnabled({
      forceColor: flags.color === true,
      suppressColor: flags["no-color"] === true,
      emitJson: flags.json === true,
    });
    await runV1({
      packageName,
      dryRun: dryRunOverride,
      noCommit: flags["no-commit"] === true,
      prune: flags.prune === true,
      yes: flags.yes === true,
      allowDirty: allowDirtyOverride,
      emitJson: flags.json === true,
      colorEnabled,
    });
    return 0;
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

// Pre-scans the argv before the framework dispatches so the error
// reporter knows whether to emit a JSON envelope or human stderr
// when a runner throws. The pre-scan is conservative: a literal
// `--json` token anywhere in the trailing argv (after the
// subcommand) flips the mode. False positives (e.g. `dv add
// --message "--json"`) are tolerable — `dv add` doesn't accept
// `--json` so the value can't legitimately appear there.
//
// The framework's own `ctx.mode` is hardcoded to "human" (it
// doesn't know which command's `--json` flag is the relevant
// one). dv resolves the mode at the binary boundary instead.
interface DetectReportModeArgs {
  argv: string[];
}

interface DetectedReportMode {
  emitJson: boolean;
  colorEnabled: boolean;
}

function detectReportMode(args: DetectReportModeArgs): DetectedReportMode {
  const emitJson = args.argv.includes("--json");
  const suppressColor =
    args.argv.includes("--no-color") || Deno.env.get("NO_COLOR") !== undefined;
  // Errors render to stderr; mirror the stdout TTY check used by
  // the success-path renderers so the color decision stays
  // consistent (a redirected stdout almost always means a piped
  // run, where color escapes corrupt downstream parsing).
  const colorEnabled = emitJson
    ? false
    : suppressColor
      ? false
      : Deno.stderr.isTerminal();
  return { emitJson, colorEnabled };
}

function makeReportDvError(
  detectedMode: DetectedReportMode,
): (caughtError: unknown, ctx: ReportErrorContext) => void {
  return (caughtError, _ctx) => {
    // The framework hands us a CliError (it auto-wraps non-
    // CliError throws via `code: "unknown"`), so we never need to
    // re-narrow here. We ignore the framework's ctx.mode — dv
    // resolves mode at the argv boundary, not per-command, so the
    // pre-scanned value is authoritative.
    if (!(caughtError instanceof CliError)) {
      // Defensive fallback for the (impossible-per-contract)
      // case the framework doesn't pre-wrap.
      console.error(`dv: ${String(caughtError)}`);
      return;
    }
    const rendered = renderCliError({
      err: caughtError,
      mode: detectedMode.emitJson ? "json" : "human",
      colorEnabled: detectedMode.colorEnabled,
    });
    if (detectedMode.emitJson) {
      // JSON mode goes to stderr verbatim — the consumer parses
      // the envelope from stderr while normal command output
      // (which may itself be JSON) flows on stdout.
      console.error(rendered);
    } else {
      // Human mode: prefix the binary name so output looks like
      // `dv error[dirty-tree]: working tree is not clean`. The
      // renderer leaves the prefix to the consumer.
      console.error(`dv ${rendered}`);
    }
  };
}

export function main(argv: string[]): Promise<number> {
  const detectedMode = detectReportMode({ argv });
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
      v1: v1Command,
    },
    reportError: makeReportDvError(detectedMode),
  });
  return cli.run(argv);
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
