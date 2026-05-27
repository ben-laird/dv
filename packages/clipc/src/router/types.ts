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

export interface CliRequest<Ctx = unknown> {
  // Unconsumed argv tail. The root receives the full argv; each
  // router slices its own subcommand token off before handing the
  // remainder to the matched child.
  argv: string[];

  // Breadcrumb of node names from the root to the current handler,
  // e.g. ["dv", "plugin", "invoke"]. Used by `--help` text and
  // error renderers so they know what to call themselves without
  // having to be told.
  path: string[];

  // Caller-supplied context. The framework is generic on this; dv
  // (or any other consumer) decides the shape. A parent router with
  // its own logic can enrich the ctx and pass an updated version
  // along via `next(child, { ctx: enriched, ... })`.
  ctx: Ctx;

  // Color preference for any text the handler renders (typically
  // auto-generated --help). Plumbed by the framework from its
  // OutputMode resolver so help renderers don't have to make their
  // own TTY/NO_COLOR decisions. Handlers that don't render colored
  // output can ignore this.
  colorEnabled: boolean;
}

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

export interface DoneStep {
  kind: "done";
  response: CliResponse;
}

export interface NextStep<Ctx> {
  kind: "next";
  handler: CliHandler<Ctx>;
  argv: string[];
  ctx: Ctx;
  // The child's name in the tree. Pushed onto the request's `path`
  // breadcrumb so the next handler sees the right `["dv","plugin",
  // "invoke"]` chain. Routers always pass the matched key here.
  subcommandName: string;
}

export type Step<Ctx> = DoneStep | NextStep<Ctx>;

export type CliHandler<Ctx = unknown> = (
  req: CliRequest<Ctx>,
) => Step<Ctx> | Promise<Step<Ctx>>;

// Convenience constructors. Leaves use `done(response)` exclusively;
// routers and parents-with-logic use `next(...)` to delegate.

export function done(response: CliResponse): DoneStep {
  return { kind: "done", response };
}

export interface NextOptions<Ctx> {
  handler: CliHandler<Ctx>;
  argv: string[];
  ctx: Ctx;
  subcommandName: string;
}

export function next<Ctx>(options: NextOptions<Ctx>): NextStep<Ctx> {
  return {
    kind: "next",
    handler: options.handler,
    argv: options.argv,
    ctx: options.ctx,
    subcommandName: options.subcommandName,
  };
}
