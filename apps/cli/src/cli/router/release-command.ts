import { done, forCtx } from "@dv-cli/clipc";
import { runRelease } from "../release.ts";
import type { DvCtx } from "./ctx.ts";
import {
  resolveColorEnabled,
  resolveTristate,
  sharedOutputFlags,
} from "./shared-flags.ts";

const { command } = forCtx<DvCtx>();

export const releaseLeaf = command({
  description: "Mint per-Package tags + fire release plugins",
  flags: {
    ...sharedOutputFlags,
    "dry-run": { kind: "boolean", description: "Preview without side effects" },
    "no-dry-run": { kind: "boolean", description: "Force real run" },
    force: {
      kind: "boolean",
      description: "Re-release packages whose tags already exist",
    },
    push: { kind: "boolean", description: "git push --tags after release" },
    "no-push": { kind: "boolean", description: "Do not push tags" },
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
    const pushOverride = resolveTristate({
      positiveFlag: flags.push,
      negativeFlag: flags["no-push"],
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
    const result = await runRelease({
      dryRun: dryRunOverride,
      force: flags.force === true,
      push: pushOverride,
      yes: flags.yes === true,
      emitJson: flags.json === true,
      colorEnabled,
      allowDirty: allowDirtyOverride,
      debug: ctx.debugEnabled,
    });
    // Non-zero exit when any release Op failed (push failures throw
    // and the framework surfaces them through the kind:"error" path).
    const hasFailures = result.releaseOpOutcomes.some((outcome) => !outcome.ok);
    return done({ kind: "ok", exitCode: hasFailures ? 1 : 0 });
  },
});
