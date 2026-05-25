import { CliError, done, forCtx } from "@seshat/cli";
import { relative } from "@std/path";
import { CHANGE_TYPES, isChangeType } from "../../domain/change-type.ts";
import { runAdd } from "../add.ts";
import type { DvCtx } from "./ctx.ts";

// `dv add` migrated to the router. The --type validation that the
// legacy dispatcher did via `console.error + return 2` is now a
// typed CliError so the framework renders it through the same
// pipeline as every other error.

const { command } = forCtx<DvCtx>();

export const addLeaf = command({
  description: "File a Record (interactive or flag-driven)",
  flags: {
    type: { kind: "string", description: "Change type" },
    message: { kind: "string", description: "Record body" },
    notes: { kind: "string", description: "Optional notes" },
    packages: { kind: "collect", description: "Packages this Record targets" },
    links: { kind: "collect", description: "Reference URLs" },
    stage: { kind: "boolean", description: "Force `git add` after writing" },
    "no-stage": {
      kind: "boolean",
      description: "Suppress auto-staging",
    },
    editor: {
      kind: "string",
      description: "Override $EDITOR for this invocation",
    },
  },
  run: async ({ flags }) => {
    const rawChangeType = flags.type;
    if (rawChangeType !== undefined && !isChangeType(rawChangeType)) {
      return done({
        kind: "error",
        error: new CliError({
          code: "add-invalid-type",
          message: `--type must be one of ${CHANGE_TYPES.join(", ")} (got '${rawChangeType}')`,
          exitCode: 2,
        }),
      });
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
    return done({ kind: "ok" });
  },
});

// Same comma-splitting helper the legacy main.ts used. Kept local
// to the leaf since no other command needs it.
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
