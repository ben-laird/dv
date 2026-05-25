import { CliError, done, forCtx } from "@seshat/cli";
import { runRename } from "../rename.ts";
import type { DvCtx } from "./ctx.ts";
import { resolveColorEnabled, sharedOutputFlags } from "./shared-flags.ts";

const { command } = forCtx<DvCtx>();

export const renameLeaf = command({
  description: "Append a lineage edge to the rename ledger",
  flags: {
    ...sharedOutputFlags,
    at: {
      kind: "string",
      description:
        "Override the `at` version (default: inferred from discovery)",
    },
    "dry-run": {
      kind: "boolean",
      description: "Print the planned entry without writing",
    },
  },
  run: async ({ flags, argv, path }) => {
    if (argv.length !== 2) {
      return done({
        kind: "error",
        error: new CliError({
          code: "rename-bad-args",
          message: `expected exactly two arguments <old> <new>; got ${argv.length}`,
          hint: `run '${path.join(" ")} --help' for usage`,
          exitCode: 2,
        }),
      });
    }
    const fromPackageName = argv[0] ?? "";
    const toPackageName = argv[1] ?? "";
    const colorEnabled = resolveColorEnabled({
      forceColor: flags.color === true,
      suppressColor: flags["no-color"] === true,
      emitJson: flags.json === true,
    });
    await runRename({
      fromPackageName,
      toPackageName,
      atVersionOverride: flags.at,
      dryRun: flags["dry-run"] === true,
      emitJson: flags.json === true,
      colorEnabled,
    });
    return done({ kind: "ok" });
  },
});
