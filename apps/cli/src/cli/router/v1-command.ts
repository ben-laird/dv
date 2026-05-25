import { CliError, done, forCtx } from "@seshat/cli";
import { runV1 } from "../v1.ts";
import type { DvCtx } from "./ctx.ts";
import {
  resolveColorEnabled,
  resolveTristate,
  sharedOutputFlags,
} from "./shared-flags.ts";

const { command } = forCtx<DvCtx>();

export const v1Leaf = command({
  description: "Promote a 0.x Package to 1.0.0 (the stability promise)",
  flags: {
    ...sharedOutputFlags,
    "dry-run": { kind: "boolean", description: "Preview without writing" },
    "no-dry-run": { kind: "boolean", description: "Force real run" },
    "no-commit": {
      kind: "boolean",
      description: "Bump + write CHANGELOG but skip the git commit",
    },
    prune: {
      kind: "boolean",
      description: "Drop Records whose package is unresolved",
    },
    yes: {
      kind: "boolean",
      alias: "y",
      description: "Skip confirmation prompts",
    },
    "allow-dirty": {
      kind: "boolean",
      description: "Run even if the working tree is dirty",
    },
    "no-allow-dirty": { kind: "boolean", description: "Require clean tree" },
  },
  run: async ({ flags, argv, path, ctx }) => {
    if (argv.length !== 1) {
      return done({
        kind: "error",
        error: new CliError({
          code: "v1-bad-args",
          message: `expected exactly one <package> argument; got ${argv.length}`,
          hint: `run '${path.join(" ")} --help' for usage`,
          exitCode: 2,
        }),
      });
    }
    const packageName = argv[0] ?? "";
    const dryRunOverride = resolveTristate({
      positiveFlag: flags["dry-run"],
      negativeFlag: flags["no-dry-run"],
    });
    const allowDirtyOverride = resolveTristate({
      positiveFlag: flags["allow-dirty"],
      negativeFlag: flags["no-allow-dirty"],
    });
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
      debug: ctx.debugEnabled,
    });
    return done({ kind: "ok" });
  },
});
