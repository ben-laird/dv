import { done, forCtx } from "@dv-cli/clipc";
import { join, relative } from "@std/path";
import {
  CONFIG_DIR,
  configPath,
  recordsPath,
} from "../../subtools/config/mod.ts";
import { runInit } from "../init.ts";
import type { DvCtx } from "./ctx.ts";

// `dv init` migrated to the router. The runner already produces a
// structured result; this leaf does the print-or-JSON-envelope step
// the old `defineCommand` wrapper used to do.

const { command } = forCtx<DvCtx>();

export const initLeaf = command({
  description: "Scaffold .dv/config.yaml + records/",
  flags: {
    json: { kind: "boolean", description: "Emit JSON envelope output" },
  },
  run: async ({ flags }) => {
    const initResult = await runInit();

    if (flags.json === true) {
      // Structured success envelope — symmetric with the cli-error
      // envelope so scripted scaffolding flows can read `created`
      // vs `alreadyInitialized` directly without parsing stdout text.
      const configRelative = relative(
        initResult.repoRoot,
        configPath(initResult.repoRoot),
      );
      const recordsRelative = `${relative(
        initResult.repoRoot,
        recordsPath(initResult.repoRoot),
      )}/`;
      const gitignoreRelative = relative(
        initResult.repoRoot,
        join(initResult.repoRoot, CONFIG_DIR, ".gitignore"),
      );
      const wasAlreadyInitialized =
        !initResult.configCreated &&
        !initResult.recordsDirCreated &&
        !initResult.gitignoreCreated;
      console.log(
        JSON.stringify(
          {
            schema: "urn:dv:schema:v1:init-result",
            repoRoot: initResult.repoRoot,
            alreadyInitialized: wasAlreadyInitialized,
            created: {
              config: initResult.configCreated ? configRelative : null,
              recordsDir: initResult.recordsDirCreated ? recordsRelative : null,
              gitignore: initResult.gitignoreCreated ? gitignoreRelative : null,
            },
          },
          null,
          2,
        ),
      );
      return done({ kind: "ok" });
    }

    if (
      !initResult.configCreated &&
      !initResult.recordsDirCreated &&
      !initResult.gitignoreCreated
    ) {
      console.log("dv: already initialized");
      return done({ kind: "ok" });
    }
    if (initResult.configCreated) {
      console.log(
        `created ${relative(
          initResult.repoRoot,
          configPath(initResult.repoRoot),
        )}`,
      );
    }
    if (initResult.recordsDirCreated) {
      console.log(
        `created ${relative(
          initResult.repoRoot,
          recordsPath(initResult.repoRoot),
        )}/`,
      );
    }
    if (initResult.gitignoreCreated) {
      console.log(`created ${CONFIG_DIR}/.gitignore`);
    }
    return done({ kind: "ok" });
  },
});
