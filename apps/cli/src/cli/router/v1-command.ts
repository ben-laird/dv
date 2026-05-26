import { CliError, done, forCtx } from "@seshat/cli";
import { runV1, runV1Catalog } from "../v1.ts";
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
    // Two arities: 0 args (catalog mode, dry-run-only) or 1 arg
    // (the package to promote). Anything else is a usage error.
    if (argv.length > 1) {
      return done({
        kind: "error",
        error: new CliError({
          code: "v1-bad-args",
          message: `expected at most one <package> argument; got ${argv.length}`,
          hint: `run '${path.join(" ")} --help' for usage`,
          exitCode: 2,
        }),
      });
    }
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

    if (argv.length === 0) {
      // Catalog mode: list every Unstable Package with its
      // projected promotion. runV1Catalog enforces the
      // dry-run-only invariant (the leaf doesn't read config so
      // can't pre-check `safety.dry-run-by-default`).
      await runV1Catalog({
        dryRun: dryRunOverride,
        prune: flags.prune === true,
        emitJson: flags.json === true,
        colorEnabled,
        debug: ctx.debugEnabled,
      });
      return done({ kind: "ok" });
    }

    const packageName = argv[0] ?? "";
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
