import { CliError } from "../errors.ts";
import type { CliHandler, CliRequest, CliResponse } from "./types.ts";

// The trampoline driver. Calls `initialHandler` with the initial
// request; if it returns `done`, return the response. If it returns
// `next`, loop with the new handler + argv + ctx and an extended
// path breadcrumb. Continues until done.
//
// Effect-style error policy: typed errors are returned via
// `{ kind: "error" }` in CliResponse, and the runner's contract is
// "return don't throw." A throw is a bug we degrade gracefully on:
// the outermost catch here wraps it into a `kind: "error"` with the
// `code: "unknown"` shape, so the framework still renders something
// useful, but the path is clearly the degraded one rather than the
// expected one. Code that wants its failure to be first-class
// returns it.
//
// Why a trampoline rather than recursive `await child.handle(...)`
// calls? Two reasons:
//   1. Parents can declare their own pre-work + flags and hand off
//      via `next(child, ...)` without their handler holding a JS
//      stack frame open for the duration of the child's run.
//   2. The driver is the single chokepoint where every dispatch
//      hop is observable — easy to add tracing, depth limits, or
//      middleware later without touching each handler.

export interface DriveArgs<Ctx> {
  initialHandler: CliHandler<Ctx>;
  initialRequest: CliRequest<Ctx>;
}

// Safety net so a runaway parent chain (a router that mistakenly
// `next`s back to itself) doesn't spin forever. The framework
// surfaces it as a hard error since it's a bug in the tree, not
// a user-actionable mistake.
const MAX_TRAMPOLINE_HOPS = 64;

export async function drive<Ctx>(args: DriveArgs<Ctx>): Promise<CliResponse> {
  let currentHandler = args.initialHandler;
  let currentRequest = args.initialRequest;
  let hopCount = 0;

  while (true) {
    if (hopCount > MAX_TRAMPOLINE_HOPS) {
      return {
        kind: "error",
        error: new CliError({
          code: "trampoline-runaway",
          message: `router dispatched more than ${MAX_TRAMPOLINE_HOPS} hops without reaching a terminal handler — likely a cycle in the tree`,
          hint: "check the router's `commands` map for a child that next()s back to itself",
        }),
      };
    }

    let step: Awaited<ReturnType<CliHandler<Ctx>>>;
    try {
      step = await currentHandler(currentRequest);
    } catch (caughtError) {
      // Degraded path: a handler threw rather than returning
      // `{ kind: "error" }`. Wrap into the same shape so the
      // framework's renderer still produces output, but tag with
      // `code: "unknown"` if the throw isn't already a CliError so
      // the user can distinguish "the runner returned this" from
      // "the runner threw this."
      const wrappedError =
        caughtError instanceof CliError
          ? caughtError
          : new CliError({
              code: "unknown",
              message:
                caughtError instanceof Error
                  ? caughtError.message
                  : String(caughtError),
              cause: caughtError,
            });
      return { kind: "error", error: wrappedError };
    }

    if (step.kind === "done") return step.response;

    // Trampoline hop: re-enter the loop with the new handler. The
    // child's `subcommandName` extends the request's `path`
    // breadcrumb. We do NOT default to inheriting argv/ctx — the
    // parent is responsible for slicing argv and (if it wants to)
    // enriching ctx. Forcing those to be explicit on every hop
    // keeps the protocol honest.
    currentHandler = step.handler;
    currentRequest = {
      argv: step.argv,
      ctx: step.ctx,
      path: [...currentRequest.path, step.subcommandName],
      // colorEnabled is a per-run signal, not per-hop — every
      // descendant inherits the framework's initial decision.
      colorEnabled: currentRequest.colorEnabled,
    };
    hopCount += 1;
  }
}
