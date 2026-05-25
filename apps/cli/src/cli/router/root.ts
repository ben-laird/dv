import { forCtx } from "@seshat/cli";
import { addLeaf } from "./add-command.ts";
import type { DvCtx } from "./ctx.ts";
import { initLeaf } from "./init-command.ts";
import { migrateRouter } from "./migrate-commands.ts";
import { pluginRouter } from "./plugin-commands.ts";
import { releaseLeaf } from "./release-command.ts";
import { renameLeaf } from "./rename-command.ts";
import { statusLeaf } from "./status-command.ts";
import { v1Leaf } from "./v1-command.ts";
import { validateLeaf } from "./validate-command.ts";
import { versionLeaf } from "./version-command.ts";

// The root router for `dv`. Every leaf in v1 lives here; sub-routers
// (`plugin`, `migrate`) compose their own children. main.ts wraps
// this into a `defineCli({ rootRouter: dvRoot })` call and that's
// the entire entry point — no hand-dispatched legacy branch.

const { router } = forCtx<DvCtx>();

export const dvRoot = router({
  description: "dv — language-agnostic, git-native changelog CLI",
  commands: {
    init: initLeaf,
    status: statusLeaf,
    add: addLeaf,
    validate: validateLeaf,
    version: versionLeaf,
    release: releaseLeaf,
    v1: v1Leaf,
    rename: renameLeaf,
    plugin: pluginRouter,
    migrate: migrateRouter,
  },
});
