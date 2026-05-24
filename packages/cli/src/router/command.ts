import type { FlagSpec, FlagsOf } from "../command-spec.ts";
import { CliError } from "../errors.ts";
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

export interface CommandRequest<
  TFlags extends Record<string, FlagSpec>,
  Ctx,
> {
  flags: FlagsOf<TFlags>;
  argv: string[];
  ctx: Ctx;
  path: string[];
}

export interface CommandSpec<
  Ctx,
  TFlags extends Record<string, FlagSpec>,
> {
  description?: string;
  flags: TFlags;
  run: (
    req: CommandRequest<TFlags, Ctx>,
  ) =>
    | ReturnType<CliHandler<Ctx>>
    | Awaited<ReturnType<CliHandler<Ctx>>>;
}

export interface CommandNode<Ctx = unknown> {
  // Discriminator for the router's children map (vs RouterNode).
  kind: "command";
  description?: string;
  // The wrapped CliHandler the router calls. Parses flags, then
  // invokes the user's `run`. Errors from flag parsing get
  // returned as `{ kind: "error" }` rather than thrown, matching
  // the Effect-style contract.
  handler: CliHandler<Ctx>;
  // Surface the flag spec for help rendering. Erased to FlagSpec
  // because the help renderer doesn't need (or use) the literal-type
  // narrowing the runner gets.
  flags: Record<string, FlagSpec>;
}

// Ctx comes first in the type-parameter list so callers can supply
// `command<DvCtx>({...})` and let TFlags infer from the literal
// `flags: {...}` argument. The reverse order would force every call
// site to either name the flag map at module scope or write
// `command<typeof ..., DvCtx>` (partial TS inference doesn't let
// you specify only the second of two parameters).
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
