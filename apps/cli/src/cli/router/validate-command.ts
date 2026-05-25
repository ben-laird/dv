import { done, forCtx } from "@seshat/cli";
import { runValidate } from "../validate.ts";
import type { DvCtx } from "./ctx.ts";
import { resolveColorEnabled, sharedOutputFlags } from "./shared-flags.ts";

const { command } = forCtx<DvCtx>();

export const validateLeaf = command({
  description: "Lint records and config (CI-friendly)",
  flags: { ...sharedOutputFlags },
  run: async ({ flags, ctx }) => {
    const colorEnabled = resolveColorEnabled({
      forceColor: flags.color === true,
      suppressColor: flags["no-color"] === true,
      emitJson: flags.json === true,
    });
    const validateResult = await runValidate({
      emitJson: flags.json === true,
      colorEnabled,
      debug: ctx.debugEnabled,
    });
    // validate uses a non-error exit code on a kind:"ok" path
    // (lint failures the user knows about). The framework honors
    // the response-level exitCode for the ok path.
    return done({ kind: "ok", exitCode: validateResult.exitCode });
  },
});
