import type { CliError } from "../errors.ts";

// Core protocol for the trampoline-based router. Every handler is a
// pure function from `CliRequest<Ctx>` to a `Step<Ctx>`. A step is
// either:
//
//   { kind: "done"; response }  — terminal; the driver renders the
//                                  response and exits.
//   { kind: "next"; handler;    — delegation; the driver re-enters
//             argv; ctx;         with the new handler, the unconsumed
//             subcommandName }   argv tail, and (possibly enriched)
//                                ctx. `subcommandName` extends the
//                                request's path breadcrumb so deeper
//                                handlers know where they sit in the
//                                tree without manual threading.
//
// Parents that need to do work before the matched child runs declare
// their own logic and return `next(child, ...)` after the work
// finishes. Leaves only ever return `done(...)`. The driver loops
// until it sees a `done`.
//
// CliResponse is what the framework actually renders. Three flavors:
//
//   { kind: "ok"; ... }     — runner succeeded; framework prints any
//                             stdout / json and uses the exit code.
//   { kind: "error"; ... }  — typed, expected failure that the runner
//                             returned on purpose. Effect-style: this
//                             is the contract. The framework renders
//                             via `renderCliError`.
//   { kind: "help"; text }  — a router intercepted `--help` / no-sub
//                             and produced its tree's help text.
//
// Thrown errors are bugs we degrade gracefully on, not first-class
// returns: the driver catches them at the outermost layer and wraps
// them into a `{ kind: "error" }` with code "unknown", but that path
// is the degraded one — typed runners are expected to return errors,
// not throw them.

/**
 * Input handed to every {@link CliHandler}. Carries the unconsumed argv
 * tail, the path breadcrumb from the root to the current node, the
 * caller-supplied `ctx`, and the framework-resolved color preference.
 * Each router slices its own subcommand token off `argv` and extends
 * `path` before delegating to the matched child.
 */
export interface CliRequest<Ctx = unknown> {
  /**
   * Unconsumed argv tail. The root receives the full argv; each router
   * slices its own subcommand token off before handing the remainder to
   * the matched child.
   */
  argv: string[];

  /**
   * Breadcrumb of node names from the root to the current handler, e.g.
   * `["dv", "plugin", "invoke"]`. Used by `--help` text and error
   * renderers so they know what to call themselves.
   */
  path: string[];

  /**
   * Caller-supplied context. The framework is generic on this; the
   * consumer decides the shape. A parent router can enrich it and pass an
   * updated version along via `next({ ctx: enriched, ... })`.
   */
  ctx: Ctx;

  /**
   * Color preference for any text the handler renders (typically
   * auto-generated `--help`). Plumbed from the framework's OutputMode
   * resolver so help renderers need not make their own TTY/NO_COLOR call.
   */
  colorEnabled: boolean;
}

/**
 * The terminal value the framework renders and exits on. A discriminated
 * union of three flavors: `ok` (the runner succeeded — print stdout/json
 * and use the exit code), `error` (a typed, expected failure the runner
 * returned on purpose, rendered via `renderCliError`), and `help` (a
 * router or leaf produced auto-generated help text). Thrown errors are the
 * degraded path and get wrapped into `error` by the driver.
 */
export type CliResponse =
  | {
      kind: "ok";
      // Default 0. Runners that need a non-success exit code on a
      // *non-error* path (e.g. `dv validate` returning 1 for record
      // lint failures the user knows about) set this explicitly.
      exitCode?: number;
      // Plain-text human output the framework should print to stdout.
      // Mutually agreeable with `json` — runners can produce both;
      // the framework's renderer decides which to emit based on the
      // ctx's emit-json signal (or just prints both for now).
      stdout?: string;
      // Structured machine output. When present and the consumer is
      // in JSON mode, the framework serializes this with the
      // appropriate envelope.
      json?: unknown;
    }
  | {
      kind: "error";
      error: CliError;
      // Default 1. Some error codes warrant a different code (e.g. 2
      // for "user input was wrong" vs 1 for "operation failed"); set
      // explicitly when the convention diverges.
      exitCode?: number;
    }
  | {
      kind: "help";
      text: string;
    };

/**
 * Terminal trampoline step. Returned by leaves (and parents that intercept
 * a request) to stop dispatch: the driver renders the carried
 * {@link CliResponse} and exits. Built with the `done(...)` constructor.
 */
export interface DoneStep {
  /** Discriminator marking this as a terminal step. */
  kind: "done";
  /** The response the driver renders before exiting. */
  response: CliResponse;
}

/**
 * Delegation trampoline step. Returned by routers (and parents that did
 * pre-work) to hand control to a child: the driver re-enters with the
 * given `handler`, the unconsumed `argv` tail, a possibly-enriched `ctx`,
 * and pushes `subcommandName` onto the request's path breadcrumb. Built
 * with the `next(...)` constructor.
 */
export interface NextStep<Ctx> {
  /** Discriminator marking this as a delegation step. */
  kind: "next";
  /** The child handler the driver re-enters with. */
  handler: CliHandler<Ctx>;
  /** The unconsumed argv tail to hand the child (subcommand token stripped). */
  argv: string[];
  /** The (possibly enriched) ctx the child receives. */
  ctx: Ctx;
  /**
   * The child's name in the tree. Pushed onto the request's `path`
   * breadcrumb so the next handler sees the right chain (e.g.
   * `["dv","plugin","invoke"]`). Routers pass the matched key here.
   */
  subcommandName: string;
}

/**
 * The result of running a handler: either {@link DoneStep} (terminal) or
 * {@link NextStep} (delegate to a child). The driver loops, re-entering on
 * each `next`, until it sees a `done`.
 */
export type Step<Ctx> = DoneStep | NextStep<Ctx>;

/**
 * The core router protocol: a pure (possibly async) function from a
 * {@link CliRequest} to a {@link Step}. Routers and parents-with-logic
 * return `next(...)` to delegate; leaves return `done(...)` to terminate.
 * Both {@link RouterNode} and {@link CommandNode} expose a handler of this
 * shape, which is what the trampoline driver invokes.
 */
export type CliHandler<Ctx = unknown> = (
  req: CliRequest<Ctx>,
) => Step<Ctx> | Promise<Step<Ctx>>;

// Convenience constructors. Leaves use `done(response)` exclusively;
// routers and parents-with-logic use `next(...)` to delegate.

/**
 * Constructs a terminal {@link DoneStep}. Leaves return this exclusively;
 * parents that intercept a request return it to stop dispatch and have the
 * driver render the carried {@link CliResponse}.
 *
 * @param response - The response the driver renders before exiting.
 * @returns A `DoneStep` wrapping the response.
 */
export function done(response: CliResponse): DoneStep {
  return { kind: "done", response };
}

/**
 * Options for the {@link next} delegation-step constructor: the child
 * `handler` to re-enter, the `argv` tail to hand it, the `ctx` it receives,
 * and the `subcommandName` to push onto the path breadcrumb.
 */
export interface NextOptions<Ctx> {
  /** The child handler the driver re-enters with. */
  handler: CliHandler<Ctx>;
  /** The unconsumed argv tail to hand the child. */
  argv: string[];
  /** The (possibly enriched) ctx the child receives. */
  ctx: Ctx;
  /** The matched child's name, pushed onto the request's path breadcrumb. */
  subcommandName: string;
}

/**
 * Constructs a delegation {@link NextStep}. Routers and parents-with-logic
 * return this to hand control to a child; the driver re-enters with the
 * given handler, argv tail, and ctx, extending the path breadcrumb.
 *
 * @param options - The {@link NextOptions} describing the delegation.
 * @returns A `NextStep` the trampoline driver dispatches on.
 */
export function next<Ctx>(options: NextOptions<Ctx>): NextStep<Ctx> {
  return {
    kind: "next",
    handler: options.handler,
    argv: options.argv,
    ctx: options.ctx,
    subcommandName: options.subcommandName,
  };
}
