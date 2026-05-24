import type { FlagSpec, FlagsOf } from "../command-spec.ts";
import { CliError } from "../errors.ts";
import { type CommandNode, command as makeCommand } from "./command.ts";
import { formatRouterHelp } from "./help.ts";
import {
  type CliHandler,
  type CliRequest,
  done,
  next,
  type Step,
} from "./types.ts";

// router() builds a tree node that dispatches to one of its children
// based on the first argv token. Children are either RouterNodes
// (sub-routers) or CommandNodes (leaves) — both implement the same
// CliHandler protocol, so dispatch is just "pick by name, trampoline
// in."
//
// A router MAY also declare its own `flags` and `run` — a parent
// that needs to do pre-work (validate flags, enrich ctx) before
// delegating. The runner returns a Step; if it returns `done(...)`,
// the router stops there (parent intercepted and produced a
// terminal response, e.g. `dv plugin --json` listing children).
// If it returns `next(...)`, the trampoline dispatches into the
// indicated child handler.
//
// The default behavior (no `run` declared) is plain dispatch: look
// up argv[0] in `commands`, slice it off, hand off via next().

export type RouterChild<Ctx> = RouterNode<Ctx> | CommandNode<Ctx>;

export interface RouterNode<Ctx = unknown> {
  kind: "router";
  description?: string;
  // Public surface: the children. Help generation and external tree
  // walkers read this directly; the framework's own dispatch reads
  // it via `handler` (which closes over `children`).
  children: Record<string, RouterChild<Ctx>>;
  // Optional declared flags + inherited flags. Surfaced so help
  // rendering can show them; the router's own `run` (if any) parses
  // them via the same `parseSubcommandArgv` path commands use.
  inheritedFlags: Record<string, FlagSpec>;
  // The CliHandler the framework dispatches to. Wraps the user's
  // dispatch logic (or the default one if no `run` was declared)
  // and surfaces the auto-generated help on `--help` / no-sub.
  handler: CliHandler<Ctx>;
}

export interface RouterSpec<Ctx = unknown> {
  description?: string;
  // Cross-cutting flags this router declares as inherited by its
  // descendants. The framework does NOT auto-merge these into
  // child flag maps — instead, the `inheritedFlags()` helper
  // returns the same typed map for the user to explicitly spread
  // into each leaf's flags. This keeps scoping honest: a leaf only
  // accepts the flags it declares, period.
  inheritedFlags?: Record<string, FlagSpec>;
  commands: Record<string, RouterChild<Ctx>>;
  // Optional parent-with-logic hook. Receives the unconsumed argv
  // (so a parent can peek at flags before the child runs), and
  // MUST return a Step. To delegate normally, return
  // `defaultDispatch(req, this)`. To short-circuit (e.g.
  // intercepting an aggregate `--list` flag), return `done(...)`.
  // To do pre-work and then delegate, return `next(...)` with the
  // matched child and an enriched ctx.
  //
  // If undefined, the router uses the built-in dispatch behavior.
  run?: (req: CliRequest<Ctx>, dispatch: DefaultDispatch<Ctx>) => Step<Ctx> | Promise<Step<Ctx>>;
}

// Helper passed to a parent's `run` so it can delegate to default
// behavior after doing its work. Encapsulates the child-lookup +
// argv-slice + ctx-passthrough so the parent doesn't reimplement
// it. The `ctxOverride` arg is the place to enrich ctx before the
// child sees it.
export type DefaultDispatch<Ctx> = (
  req: CliRequest<Ctx>,
  options?: { ctxOverride?: Ctx },
) => Step<Ctx>;

export function router<Ctx = unknown>(spec: RouterSpec<Ctx>): RouterNode<Ctx> {
  const inheritedFlags = spec.inheritedFlags ?? {};

  // Children may not be `undefined` — guard so a typo doesn't blow
  // up at dispatch time with a confusing message.
  for (const [childName, childNode] of Object.entries(spec.commands)) {
    if (childNode === undefined) {
      throw new Error(
        `router: child '${childName}' is undefined — check the imports in the spec object`,
      );
    }
  }

  // The default dispatch:
  //   - Find the first positional token (skipping leading flag
  //     tokens). This is the subcommand name; flags carried past
  //     the router like `dv plugin --color list` ride along to the
  //     child untouched.
  //   - If --help / -h appears BEFORE the subcommand token (or no
  //     subcommand exists) → return router help. `--help` after a
  //     subcommand belongs to that subcommand; the router doesn't
  //     intercept it.
  //   - Match → trampoline into child with the *remaining* argv.
  //   - No match → typed unknown-subcommand error.
  const defaultDispatch: DefaultDispatch<Ctx> = (req, options) => {
    let subcommandIndex = -1;
    let helpRequestedBeforeSubcommand = false;
    for (let i = 0; i < req.argv.length; i++) {
      const token = req.argv[i] ?? "";
      if (token === "--help" || token === "-h") {
        helpRequestedBeforeSubcommand = true;
        continue;
      }
      if (!token.startsWith("-")) {
        subcommandIndex = i;
        break;
      }
    }

    if (subcommandIndex === -1) {
      // No subcommand found (empty argv, all flags, or only --help
      // with no subcommand). Either way the right move is router
      // help; we don't distinguish `--help` from no-arg invocations
      // since both mean "tell me what I can do here."
      void helpRequestedBeforeSubcommand;
      return done({
        kind: "help",
        text: formatRouterHelp({
          path: req.path,
          children: spec.commands,
          colorEnabled: req.colorEnabled,
        }),
      });
    }

    if (helpRequestedBeforeSubcommand) {
      // `dv plugin --help list` is ambiguous; we treat it as "help
      // about plugin," matching the convention most tree-routed
      // CLIs use (kubectl, git, cargo). The user asked for help
      // before naming the subcommand.
      return done({
        kind: "help",
        text: formatRouterHelp({
          path: req.path,
          children: spec.commands,
          colorEnabled: req.colorEnabled,
        }),
      });
    }

    const subcommandName = req.argv[subcommandIndex] ?? "";
    const matchedChild = spec.commands[subcommandName];
    if (matchedChild === undefined) {
      return done({
        kind: "error",
        error: new CliError({
          code: "unknown-subcommand",
          message: `unknown subcommand '${subcommandName}'`,
          hint: `run '${req.path.join(" ")} --help' to see available subcommands`,
          exitCode: 2,
        }),
      });
    }
    // Strip the subcommand token but keep the surrounding flags
    // so the child's parser sees them.
    const childArgv = [
      ...req.argv.slice(0, subcommandIndex),
      ...req.argv.slice(subcommandIndex + 1),
    ];
    return next({
      handler: matchedChild.handler,
      argv: childArgv,
      ctx: options?.ctxOverride ?? req.ctx,
      subcommandName,
    });
  };

  const handler: CliHandler<Ctx> = (req) => {
    if (spec.run !== undefined) {
      return spec.run(req, defaultDispatch);
    }
    return defaultDispatch(req);
  };

  return {
    kind: "router",
    description: spec.description,
    children: spec.commands,
    inheritedFlags,
    handler,
  };
}

// inheritedFlags() is the typed-spread helper for cross-cutting flags
// like --json, --color, --no-color. The user declares the map once at
// the root (or at any router level), and then explicitly spreads it
// into every leaf that wants those flags. No magic inheritance — the
// map is just a typed value the user composes.
//
// Why an identity function rather than just `const x = {...}`? It
// captures the literal type so the spread preserves the per-flag
// `kind` narrowing in leaves. Same trick as `defineCommand` from
// the legacy API.
// `const` constraint preserves each flag's literal `kind` ("boolean",
// "string", "collect"). Without it TS widens to the union of all
// FlagSpec arms, which breaks FlagsOf narrowing at every leaf that
// spreads the result.
export function inheritedFlags<const TFlags extends Record<string, FlagSpec>>(
  flags: TFlags,
): TFlags {
  return flags;
}

// `forCtx<DvCtx>()` returns a Ctx-bound pair of `command` and `router`
// builders. The point: TS can't partially infer type parameters
// (specifying Ctx forces TFlags off the literal, and the leaf's flag
// typing collapses). Capturing Ctx in a closure lets every downstream
// `command({...})` call infer TFlags freely while still type-checking
// `req.ctx` as DvCtx.
//
// Usage:
//
//   const { command, router } = forCtx<DvCtx>();
//   const leaf = command({
//     flags: { json: { kind: "boolean" } },
//     run: ({ flags, ctx }) => { ctx.binaryArgv; flags.json; ... }
//   });
//   const myRouter = router({ commands: { leaf } });

export interface CtxBoundBuilders<Ctx> {
  command: <const TFlags extends Record<string, FlagSpec>>(
    spec: {
      description?: string;
      flags: TFlags;
      run: (req: {
        flags: FlagsOf<TFlags>;
        argv: string[];
        ctx: Ctx;
        path: string[];
      }) => Step<Ctx> | Promise<Step<Ctx>>;
    },
  ) => CommandNode<Ctx>;
  router: (spec: RouterSpec<Ctx>) => RouterNode<Ctx>;
}

export function forCtx<Ctx>(): CtxBoundBuilders<Ctx> {
  return {
    command: (spec) =>
      makeCommand<Ctx, typeof spec.flags>({
        description: spec.description,
        flags: spec.flags,
        run: spec.run,
      }),
    router: (spec) => router<Ctx>(spec),
  };
}
