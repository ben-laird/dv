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

/**
 * Input to a {@link ResolveOutputMode} resolver: the raw, untouched
 * argv, so the resolver can pre-scan for `--json` / `--no-color` at
 * the binary boundary.
 */
export interface OutputModeContext {
  /**
   * The argv as received (untouched), so the resolver can pre-scan for
   * `--json` / `--no-color` at the binary boundary.
   */
  argv: string[];
}

/**
 * The resolved output decision for a run: whether to emit JSON and
 * whether color is enabled. Drives how `ok` and `error` responses are
 * rendered.
 */
export interface OutputMode {
  /** Whether to serialize `ok`/`error` responses as JSON. */
  emitJson: boolean;
  /** Whether color is enabled for rendered output. */
  colorEnabled: boolean;
}

/**
 * Consumer-supplied hook that decides the {@link OutputMode} for a run
 * from the raw argv. Supplied by the consumer because the framework
 * can't know which leaf's `--json` flag is authoritative.
 */
export type ResolveOutputMode = (ctx: OutputModeContext) => OutputMode;

/**
 * Configuration for {@link defineCli}. `name` is the root breadcrumb
 * and `version` backs the top-level `--version`/`-V`. `rootRouter` is
 * the tree entry point, `makeContext` produces the per-run ctx,
 * `resolveOutputMode` decides JSON/color, and the optional
 * `humanErrorPrefix` prepends a label (e.g. `dv`) to human-mode error
 * output (ignored in JSON mode).
 */
export interface DefineCliConfig<Ctx> {
  /** Root breadcrumb name, the first element of every request's path. */
  name: string;
  /** Version string backing the top-level `--version` / `-V`. */
  version: string;
  /** The tree entry point the framework dispatches into. */
  rootRouter: RouterNode<Ctx>;
  /**
   * Per-run context factory. Invoked once per `run(argv)`; a parent router
   * can enrich the produced ctx via `next(...)` before children see it.
   */
  makeContext: () => Ctx;
  /**
   * Consumer-supplied hook deciding JSON mode and color for error
   * rendering, since the framework can't know which leaf's `--json` flag
   * is authoritative.
   */
  resolveOutputMode: ResolveOutputMode;
  /**
   * Optional prefix prepended to human-mode error output (e.g. `dv` yields
   * `dv error[code]: ...`). No effect in JSON mode, where it would corrupt
   * the envelope.
   */
  humanErrorPrefix?: string;
}

/**
 * A runnable CLI produced by {@link defineCli}. Call `run(argv)` with
 * the process argv (sans `node`/`deno` and script path) to execute
 * the tree; it resolves to the process exit code.
 */
export interface Cli {
  /**
   * Executes the tree against `argv` (sans `node`/`deno` and script path)
   * and resolves to the process exit code.
   */
  run(argv: string[]): Promise<number>;
}

/**
 * The framework entry point. Wires a root router, per-run ctx
 * factory, and output-mode resolver into a runnable {@link Cli}.
 * `run(argv)` handles the top-level `--version`/`-V` token directly,
 * then builds the initial request, drives the trampoline until a
 * terminal response, renders it to stdout/stderr, and returns the
 * exit code (0 for `ok`/`help`; for `error`, the response override,
 * else the error's own code, else 1).
 *
 * @param config - The {@link DefineCliConfig}: `name`, `version`,
 *   `rootRouter`, `makeContext`, `resolveOutputMode`, and optional
 *   `humanErrorPrefix`.
 * @returns A {@link Cli} whose `run(argv)` returns an exit code.
 *
 * @example
 * ```ts
 * const cli = defineCli<MyCtx>({
 *   name: "dv",
 *   version: "1.0.0",
 *   rootRouter: root,
 *   makeContext: () => ({ cwd: Deno.cwd() }),
 *   resolveOutputMode: ({ argv }) => ({
 *     emitJson: argv.includes("--json"),
 *     colorEnabled: !argv.includes("--no-color"),
 *   }),
 *   humanErrorPrefix: "dv",
 * });
 * Deno.exit(await cli.run(Deno.args));
 * ```
 */
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
