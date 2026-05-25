import { CliError, done, forCtx } from "@seshat/cli";
import {
  isPluginOpName,
  PLUGIN_OP_NAMES,
  type PluginOpName,
  runPluginInvoke,
} from "../plugin-invoke.ts";
import { runPluginList } from "../plugin-list.ts";
import { runPluginVerify } from "../plugin-verify.ts";
import type { DvCtx } from "./ctx.ts";
import { resolveColorEnabled, sharedOutputFlags } from "./shared-flags.ts";

// `dv plugin` lives entirely in the new router framework — the
// proof-point migration. Demonstrates:
//   - a sub-router under the root
//   - three command leaves under that router (list / invoke / verify)
//   - per-leaf flag specs that spread the shared --json / --color
//     flags via `sharedOutputFlags` (the inheritedFlags helper's use)
//   - leaves returning typed CliResponse instead of throwing through
//     dv's main.ts try/catch
//
// `forCtx<DvCtx>()` returns Ctx-bound builders so each leaf's
// `flags` literal infers freely while `ctx` is still typed as DvCtx.
// Without forCtx, TS's lack of partial inference forces the caller
// to either name the flag map at module scope or specify both type
// parameters — both noisy.

const { command, router } = forCtx<DvCtx>();

export const pluginRouter = router({
  description: "Plugin authoring + audit commands",
  commands: {
    list: command({
      description: "Resolve every plugin in the config and show its packages",
      flags: { ...sharedOutputFlags },
      run: async ({ flags, ctx }) => {
        const colorEnabled = resolveColorEnabled({
          forceColor: flags.color === true,
          suppressColor: flags["no-color"] === true,
          emitJson: flags.json === true,
        });
        // `runPluginList` already prints its own human/JSON output
        // (the legacy shape). The new framework still respects that
        // — we return `kind: "ok"` with no stdout/json because the
        // leaf already emitted. The exit-code-on-failure semantic
        // moves here.
        const listResult = await runPluginList({
          emitJson: flags.json === true,
          colorEnabled,
          debug: ctx.debugEnabled,
        });
        return done({
          kind: "ok",
          exitCode: listResult.hasFailures ? 1 : 0,
        });
      },
    }),

    invoke: command({
      description: "Run one plugin Op with controlled inputs (debugger)",
      flags: {
        ...sharedOutputFlags,
        "repo-root": { kind: "string" },
        glob: { kind: "string" },
        package: { kind: "string", alias: "p" },
        path: { kind: "string" },
        "new-version": { kind: "string" },
        "git-tag": { kind: "string" },
        trigger: {
          kind: "string",
          description:
            "finalize-only: sets DV_FINALIZE_TRIGGER ('version' or 'v1')",
        },
        "bumped-packages": {
          kind: "string",
          description:
            "finalize-only: JSON payload for DV_BUMPED_PACKAGES (default: [])",
        },
        "stdin-json": { kind: "string" },
      },
      run: async ({ flags, argv, path, ctx }) => {
        if (argv.length !== 2) {
          return done({
            kind: "error",
            error: new CliError({
              code: "bad-args",
              exitCode: 2,
              message: `expected <plugin> <op>; got ${argv.length} argument${
                argv.length === 1 ? "" : "s"
              }`,
              hint: `run '${path.join(" ")} --help' for usage`,
            }),
          });
        }
        const pluginPositional = argv[0] ?? "";
        const rawOpName = argv[1] ?? "";
        if (!isPluginOpName(rawOpName)) {
          return done({
            kind: "error",
            error: new CliError({
              code: "bad-args",
              exitCode: 2,
              message: `unknown op '${rawOpName}' (one of: ${PLUGIN_OP_NAMES.join(", ")})`,
            }),
          });
        }
        const opName: PluginOpName = rawOpName;
        const colorEnabled = resolveColorEnabled({
          forceColor: flags.color === true,
          suppressColor: flags["no-color"] === true,
          emitJson: flags.json === true,
        });
        const rawTrigger = flags.trigger;
        if (
          rawTrigger !== undefined &&
          rawTrigger !== "version" &&
          rawTrigger !== "v1"
        ) {
          return done({
            kind: "error",
            error: new CliError({
              code: "bad-args",
              exitCode: 2,
              message: `--trigger must be 'version' or 'v1' (got '${rawTrigger}')`,
            }),
          });
        }
        await runPluginInvoke({
          pluginPositional,
          opName,
          packageName: flags.package,
          packagePath: flags.path,
          repoRoot: flags["repo-root"],
          discoverGlob: flags.glob,
          newVersion: flags["new-version"],
          gitTag: flags["git-tag"],
          finalizeTrigger: rawTrigger,
          bumpedPackagesJson: flags["bumped-packages"],
          stdinJson: flags["stdin-json"],
          emitJson: flags.json === true,
          colorEnabled,
          debug: ctx.debugEnabled,
        });
        return done({ kind: "ok" });
      },
    }),

    verify: command({
      description: "Conformance smoke test against a plugin (CI-friendly)",
      flags: {
        ...sharedOutputFlags,
        "repo-root": { kind: "string" },
        glob: { kind: "string" },
      },
      run: async ({ flags, argv, path, ctx }) => {
        if (argv.length !== 1) {
          return done({
            kind: "error",
            error: new CliError({
              code: "bad-args",
              exitCode: 2,
              message: `expected <plugin>; got ${argv.length} argument${
                argv.length === 1 ? "" : "s"
              }`,
              hint: `run '${path.join(" ")} --help' for usage`,
            }),
          });
        }
        const pluginPositional = argv[0] ?? "";
        const colorEnabled = resolveColorEnabled({
          forceColor: flags.color === true,
          suppressColor: flags["no-color"] === true,
          emitJson: flags.json === true,
        });
        const verifyResult = await runPluginVerify({
          pluginPositional,
          repoRoot: flags["repo-root"],
          discoverGlob: flags.glob,
          emitJson: flags.json === true,
          colorEnabled,
          debug: ctx.debugEnabled,
        });
        return done({
          kind: "ok",
          exitCode: verifyResult.failedCount > 0 ? 1 : 0,
        });
      },
    }),
  },
});
