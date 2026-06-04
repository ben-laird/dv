import { CliError } from "../errors.ts";
import type { FlagSpec, FlagsOf } from "../flag-spec.ts";
import { parseSubcommandArgv, UnknownFlagError } from "../parse-subcommand.ts";
import { formatCommandHelp } from "./help.ts";
import { type CliHandler, type CliRequest, done } from "./types.ts";

// A leaf command in the router tree. `command()` is the user-facing
// builder; the value it returns is a CommandNode (carrying its
// metadata for help generation) plus a CliHandler the router can
// dispatch to.
//
// Author shape:
//
//   const fooCommand = command({
//     description: "do the foo thing",
//     flags: { json: { kind: "boolean" } },
//     run: ({ flags, argv, ctx, path }) => done({ kind: "ok" }),
//   });
//
// The runner receives the parsed flags (typed from the literal flag
// map), the unconsumed positional argv after flag parsing, the
// shared ctx, and the breadcrumb path. It MUST return a Step (via
// `done(...)`). It MAY return a Promise<Step>.

/**
 * The argument a leaf command's `run` receives: the parsed flags
 * (typed from the literal flag map), the unconsumed positional argv
 * after flag parsing, the shared per-run `ctx`, and the breadcrumb
 * `path` (e.g. `["dv", "plugin", "list"]`) for help and error text.
 */
export interface CommandRequest<TFlags extends Record<string, FlagSpec>, Ctx> {
  /** Parsed flags, typed from the literal flag-spec map. */
  flags: FlagsOf<TFlags>;
  /** Positional argv remaining after flag parsing. */
  argv: string[];
  /** Shared per-run context. */
  ctx: Ctx;
  /** Breadcrumb path to this leaf, e.g. `["dv", "plugin", "list"]`. */
  path: string[];
}

/**
 * The author-facing definition of a leaf command, passed to
 * {@link command}. `description` feeds help text, `flags` is the
 * literal flag-spec map (drives both parsing and help), and `run` is
 * the handler invoked with the parsed {@link CommandRequest}. `run`
 * must return a `Step` (via `done(...)`) and may return a Promise.
 */
export interface CommandSpec<Ctx, TFlags extends Record<string, FlagSpec>> {
  /** Optional one-line description shown in help text. */
  description?: string;
  /** The literal flag-spec map; drives both parsing and help rendering. */
  flags: TFlags;
  /** Handler invoked with the parsed {@link CommandRequest}; returns a `Step`. */
  run: (
    req: CommandRequest<TFlags, Ctx>,
  ) => ReturnType<CliHandler<Ctx>> | Awaited<ReturnType<CliHandler<Ctx>>>;
}

/**
 * A built leaf node in the router tree (the value {@link command}
 * returns). Carries the `description` and `flags` for help rendering
 * plus the wrapped {@link CliHandler} the router dispatches to. The
 * `kind: "command"` discriminator distinguishes it from a
 * `RouterNode` in a router's children map.
 */
export interface CommandNode<Ctx = unknown> {
  /** Discriminator marking this child as a leaf (vs a `RouterNode`). */
  kind: "command";
  /** Optional description surfaced in help text. */
  description?: string;
  /**
   * The wrapped handler the router dispatches to: parses flags, then
   * invokes the user's `run`. Flag-parse failures are returned as
   * `{ kind: "error" }` rather than thrown.
   */
  handler: CliHandler<Ctx>;
  /**
   * The flag spec, erased to `FlagSpec` for help rendering (the help
   * renderer doesn't need the literal-type narrowing the runner gets).
   */
  flags: Record<string, FlagSpec>;
}

// Ctx comes first in the type-parameter list so callers can supply
// `command<DvCtx>({...})` and let TFlags infer from the literal
// `flags: {...}` argument. The reverse order would force every call
// site to either name the flag map at module scope or write
// `command<typeof ..., DvCtx>` (partial TS inference doesn't let
// you specify only the second of two parameters).
/**
 * Defines a leaf command in the router tree. Returns a
 * {@link CommandNode} whose handler intercepts `--help`/`-h`, parses
 * `spec.flags` from the incoming argv, and then invokes `spec.run`
 * with the typed flags, remaining positional argv, shared ctx, and
 * breadcrumb path. An undeclared flag is returned as a typed
 * `unknown-flag` error (exit 2), not thrown.
 *
 * `Ctx` is the first type parameter so callers can write
 * `command<MyCtx>({...})` and let `TFlags` infer from the literal
 * `flags` object.
 *
 * @param spec - The command definition: optional `description`, the
 *   literal `flags` map, and the `run` handler.
 * @returns A {@link CommandNode} to register as a router child.
 *
 * @example
 * ```ts
 * const listCommand = command<MyCtx>({
 *   description: "list installed plugins",
 *   flags: { json: { kind: "boolean" } },
 *   run: ({ flags, ctx }) =>
 *     done({ kind: "ok", json: flags.json ? ctx.plugins : undefined }),
 * });
 * ```
 */
export function command<
  Ctx = unknown,
  TFlags extends Record<string, FlagSpec> = Record<string, FlagSpec>,
>(spec: CommandSpec<Ctx, TFlags>): CommandNode<Ctx> {
  const handler: CliHandler<Ctx> = async (request: CliRequest<Ctx>) => {
    // Intercept --help/-h before flag parsing so leaves don't have
    // to declare it. The framework owns this token at every node;
    // a leaf that genuinely wants `--help` as a domain flag would
    // be... ill-advised, so this isn't worth a config knob.
    if (request.argv.includes("--help") || request.argv.includes("-h")) {
      return done({
        kind: "help",
        text: formatCommandHelp({
          path: request.path,
          description: spec.description,
          flags: spec.flags,
          colorEnabled: request.colorEnabled,
        }),
      });
    }
    let parsed: ReturnType<typeof parseSubcommandArgv>;
    try {
      parsed = parseSubcommandArgv({
        flagSpecMap: spec.flags,
        subcommandArgv: request.argv,
      });
    } catch (caughtError) {
      if (caughtError instanceof UnknownFlagError) {
        // Typed-error path: the user passed an undeclared flag.
        // Returning `kind: "error"` keeps the trampoline driver
        // out of its degraded-throw branch — this is an expected
        // failure shape the framework knows how to render. Exit 2
        // is a property of the error code (POSIX "command-line
        // usage error"), so it lives on the CliError itself.
        return done({
          kind: "error",
          error: new CliError({
            code: "unknown-flag",
            message: `unknown flag '${caughtError.flagToken}'`,
            hint: `run '${request.path.join(" ")} --help' for usage`,
            exitCode: 2,
          }),
        });
      }
      throw caughtError;
    }
    const result = await spec.run({
      flags: parsed.flags as FlagsOf<TFlags>,
      argv: parsed.argv,
      ctx: request.ctx,
      path: request.path,
    });
    return result;
  };

  return {
    kind: "command",
    description: spec.description,
    handler,
    flags: spec.flags,
  };
}
