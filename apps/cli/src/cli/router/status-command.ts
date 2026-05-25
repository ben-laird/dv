import { done, forCtx } from "@seshat/cli";
import { runStatus } from "../status.ts";
import type { DvCtx } from "./ctx.ts";
import { resolveColorEnabled, sharedOutputFlags } from "./shared-flags.ts";

const { command } = forCtx<DvCtx>();

export const statusLeaf = command({
  description: "Show what dv would do (read-only)",
  flags: { ...sharedOutputFlags },
  run: async ({ flags }) => {
    const colorEnabled = resolveColorEnabled({
      forceColor: flags.color === true,
      suppressColor: flags["no-color"] === true,
      emitJson: flags.json === true,
    });
    await runStatus({ emitJson: flags.json === true, colorEnabled });
    return done({ kind: "ok" });
  },
});
