import { CliError } from "../errors.ts";
import {
  checkFlagSpecMap,
  describeFlagSpecError,
  type FlagSchemaInputCheck,
  type FlagSpec,
  type FlagsOf,
} from "../flag-spec.ts";
import { parseCommandArgv } from "../parse-command-argv.ts";
import type { FlagParseError } from "../parse-subcommand.ts";
import { formatCommandHelp } from "./help.ts";
import { requestsHelp } from "./help-request.ts";
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
  /**
   * Positional argv remaining after flag parsing, each word exactly as typed
   * (`007` stays `"007"`). Words after `--` land here too, even `--help`.
   */
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
 * {@link CommandNode} whose handler intercepts `--help`/`-h` (before
 * any `--`), parses `spec.flags` from the incoming argv, validates each
 * flag value typed against its `choices` or `schema` (awaited, in argv
 * order), and then invokes `spec.run`
 * with the typed flags, remaining positional argv, shared ctx, and
 * breadcrumb path. An undeclared flag is returned as a typed
 * `unknown-flag` error (exit 2), and a refused value (outside `choices`,
 * or failed or thrown by its `schema`) as an `invalid-flag-value` error
 * (exit 2), not thrown; a `collect` flag's refused value is named by place
 * (`--pkg #2`). A `schema` whose input can't be a string, such as
 * `z.number()`, fails to type-check (see {@link FlagSchemaInputCheck}).
 * A flag map that contradicts itself is a bug in the CLI, so `command`
 * throws on it when the tree is built: an `"optional-value"` flag `x`
 * beside a declared `no-x`; an `"optional-value"` flag named `no-y` beside
 * a declared `y`; or `"true"`/`"false"` in an `"optional-value"` flag's
 * `choices` when it sets `booleans: true`.
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
  const TFlags extends Record<string, FlagSpec> = Record<string, FlagSpec>,
>(
  spec: CommandSpec<Ctx, TFlags> & { flags: FlagSchemaInputCheck<TFlags> },
): CommandNode<Ctx> {
  // A flag map that contradicts itself is a bug in the CLI, not in what a
  // user typed, so it panics here, when the tree is built, not per run.
  const flagSpecCheck = checkFlagSpecMap(spec.flags);
  if (!flagSpecCheck.ok) {
    throw new Error(describeFlagSpecError(flagSpecCheck.error));
  }
  const handler: CliHandler<Ctx> = async (request: CliRequest<Ctx>) => {
    // Intercept --help/-h before flag parsing so leaves don't have
    // to declare it. The framework owns this token at every node;
    // a leaf that genuinely wants `--help` as a domain flag would
    // be... ill-advised, so this isn't worth a config knob. After
    // `--` it is a word like any other, and reaches the leaf.
    if (requestsHelp(request.argv)) {
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
    // Lexing is sync; each flag value is then validated, awaited, so a
    // schema may be async. `--help` above never reaches either step.
    const parsed = await parseCommandArgv({
      flagSpecMap: spec.flags,
      subcommandArgv: request.argv,
    });
    if (!parsed.ok) {
      return done({
        kind: "error",
        error: flagParseCliError({
          flagParseError: parsed.error,
          path: request.path,
        }),
      });
    }
    const result = await spec.run({
      flags: parsed.value.flags,
      argv: parsed.value.argv,
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

interface FlagParseCliErrorArgs {
  flagParseError: FlagParseError;
  path: string[];
}

// A flag-parse failure is the user's typing, not a bug, so it is a typed
// error, not a throw. Exit 2 (POSIX "command-line usage error") is a
// property of what failed, so it lives on the CliError itself.
function flagParseCliError(args: FlagParseCliErrorArgs): CliError {
  const hint = `run '${args.path.join(" ")} --help' for usage`;
  switch (args.flagParseError.kind) {
    case "unknown-flag":
      return new CliError({
        code: "unknown-flag",
        message: `unknown flag '${args.flagParseError.flagToken}'`,
        hint,
        exitCode: 2,
      });
    case "invalid-flag-value": {
      const { flagName, value, element, issues, allowedValues } =
        args.flagParseError;
      const reasons = issues.map((issue) => issue.message).join("; ");
      // A collect flag's refused value is named by place: `--pkg #2`.
      const flagLabel =
        element === undefined ? `--${flagName}` : `--${flagName} #${element}`;
      return new CliError({
        code: "invalid-flag-value",
        message: `invalid value '${value}' for '${flagLabel}': ${reasons}`,
        hint,
        exitCode: 2,
        context: {
          flagName,
          value,
          issues: issues.map((issue) => ({ message: issue.message })),
          ...(allowedValues !== undefined && {
            allowedValues: [...allowedValues],
          }),
        },
      });
    }
  }
}
