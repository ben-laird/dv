import { done, forCtx } from "@dv-cli/clipc";
import { runVersion } from "../version.ts";
import type { DvCtx } from "./ctx.ts";
import {
  resolveColorEnabled,
  resolveTristate,
  sharedOutputFlags,
} from "./shared-flags.ts";

const { command } = forCtx<DvCtx>();

export const versionLeaf = command({
  description: "Consume Records → bump versions, write CHANGELOGs, commit",
  flags: {
    ...sharedOutputFlags,
    "dry-run": { kind: "boolean", description: "Preview without writing" },
    "no-dry-run": { kind: "boolean", description: "Force real run" },
    "no-commit": {
      kind: "boolean",
      description: "Bump + write CHANGELOGs but skip the git commit",
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
  run: async ({ flags, ctx }) => {
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
    await runVersion({
      dryRun: dryRunOverride,
      noCommit: flags["no-commit"] === true,
      prune: flags.prune === true,
      emitJson: flags.json === true,
      colorEnabled,
      yes: flags.yes === true,
      allowDirty: allowDirtyOverride,
      debug: ctx.debugEnabled,
    });
    return done({ kind: "ok" });
  },
});
