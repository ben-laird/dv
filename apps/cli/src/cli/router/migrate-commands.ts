import { done, forCtx } from "@dv-cli/clipc";
import { runMigrateConfig } from "../migrate.ts";
import type { DvCtx } from "./ctx.ts";
import { resolveColorEnabled, sharedOutputFlags } from "./shared-flags.ts";

// `dv migrate` is a compound subcommand fan-out. v1 ships just
// `dv migrate config`; future breaking config changes will add
// siblings (e.g. `dv migrate records` if the record schema ever
// breaks) by adding entries to `commands` here.

const { command, router } = forCtx<DvCtx>();

export const migrateRouter = router({
  description: "Schema migrations between dv versions",
  commands: {
    config: command({
      description: "Rewrite .dv/config.yaml to the current schema shape",
      flags: {
        ...sharedOutputFlags,
        "dry-run": {
          kind: "boolean",
          description: "Print the planned changes without writing",
        },
      },
      run: async ({ flags }) => {
        const colorEnabled = resolveColorEnabled({
          forceColor: flags.color === true,
          suppressColor: flags["no-color"] === true,
          emitJson: flags.json === true,
        });
        await runMigrateConfig({
          dryRun: flags["dry-run"] === true,
          emitJson: flags.json === true,
          colorEnabled,
        });
        return done({ kind: "ok" });
      },
    }),
  },
});
