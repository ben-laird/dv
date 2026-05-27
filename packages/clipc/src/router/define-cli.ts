import { renderCliError } from "../render-cli-error.ts";
import { drive } from "./drive.ts";
import type { RouterNode } from "./router.ts";
import type { CliRequest, CliResponse } from "./types.ts";

// The entry point for the framework. Takes a root router + per-run
// ctx factory + output-mode resolver and returns a Cli whose
// `.run(argv)` returns an exit code.
//
// The framework's job is:
//   1. Wrap argv + caller-supplied ctx into a CliRequest.
//   2. Invoke the trampoline driver, which loops until a terminal
//      CliResponse comes back.
//   3. Render the CliResponse to stdout/stderr and return an exit code.
//
// Render policy:
//   - `ok`    → print `stdout` (if any) to stdout, or `json` (if
//               present and ctx says emit-json) as JSON. Exit
//               code defaults to 0.
//   - `error` → render via renderCliError to stderr. Mode and color
//               come from the consumer-supplied resolveOutputMode
//               hook (since the framework can't know which leaf's
//               `--json` flag is authoritative for a given run).
//   - `help`  → print `text` to stdout. Exit 0.

export interface OutputModeContext {
  // The argv as received (untouched). Lets the resolver pre-scan
  // for `--json` / `--no-color` at the binary boundary the same
  // way dv's main.ts does today.
  argv: string[];
}

export interface OutputMode {
  emitJson: boolean;
  colorEnabled: boolean;
}

export type ResolveOutputMode = (ctx: OutputModeContext) => OutputMode;

export interface DefineCliConfig<Ctx> {
  name: string;
  version: string;
  rootRouter: RouterNode<Ctx>;
  // Per-run context. Frameworks consume the request by handing this
  // through; a parent router with its own logic can enrich it via
  // next(...) before the child sees it.
  makeContext: () => Ctx;
  // How to decide if we're in json mode + whether colors are on for
  // error rendering. Consumer-supplied because the framework can't
  // know which leaf's `--json` flag matters.
  resolveOutputMode: ResolveOutputMode;
  // Optional prefix prepended to human-mode error output. dv uses
  // this to get `dv error[code]: ...` instead of bare `error[code]:`.
  // No effect in JSON mode (the prefix would corrupt the envelope).
  humanErrorPrefix?: string;
}

export interface Cli {
  run(argv: string[]): Promise<number>;
}

export function defineCli<Ctx>(config: DefineCliConfig<Ctx>): Cli {
  return {
    async run(argv: string[]): Promise<number> {
      // Top-level --version sits at the framework layer, not the
      // router, since it isn't tied to any subcommand and the
      // version string lives in the framework config. Same for the
      // single bare top-level help token; the router handles
      // nested help and unknown-subcommand cases.
      const firstToken = argv[0];
      if (firstToken === "--version" || firstToken === "-V") {
        console.log(config.version);
        return 0;
      }

      const outputMode = config.resolveOutputMode({ argv });
      const initialRequest: CliRequest<Ctx> = {
        argv,
        path: [config.name],
        ctx: config.makeContext(),
        colorEnabled: outputMode.colorEnabled,
      };

      const response = await drive({
        initialHandler: config.rootRouter.handler,
        initialRequest,
      });

      return renderResponse({
        response,
        outputMode,
        humanErrorPrefix: config.humanErrorPrefix,
      });
    },
  };
}

interface RenderResponseArgs {
  response: CliResponse;
  outputMode: OutputMode;
  humanErrorPrefix?: string;
}

function renderResponse(args: RenderResponseArgs): number {
  const { response, outputMode } = args;
  if (response.kind === "help") {
    console.log(response.text);
    return 0;
  }
  if (response.kind === "ok") {
    if (outputMode.emitJson && response.json !== undefined) {
      console.log(JSON.stringify(response.json, null, 2));
    } else if (response.stdout !== undefined) {
      console.log(response.stdout);
    } else if (response.json !== undefined) {
      // Runner emitted JSON but we're in human mode and have no
      // stdout fallback — print the JSON anyway since the runner
      // declared output of some kind. Human-only output is
      // optional but at least we don't silently drop the result.
      console.log(JSON.stringify(response.json, null, 2));
    }
    return response.exitCode ?? 0;
  }
  // error path. Exit code precedence: response override → error's
  // own exitCode → 1. The error-owned exitCode is the typical path
  // (a code's "right" exit lives with the code); the response-level
  // override is for cases where the same error means different exit
  // codes in different contexts (rare).
  const renderedErrorText = renderCliError({
    err: response.error,
    mode: outputMode.emitJson ? "json" : "human",
    colorEnabled: outputMode.colorEnabled,
  });
  // Human-mode prefix lets consumers see `dv error[code]: ...`
  // rather than bare `error[code]:`. Suppressed in JSON mode where
  // any prefix would corrupt the envelope.
  if (!outputMode.emitJson && args.humanErrorPrefix !== undefined) {
    console.error(`${args.humanErrorPrefix} ${renderedErrorText}`);
  } else {
    console.error(renderedErrorText);
  }
  return response.exitCode ?? response.error.exitCode ?? 1;
}
