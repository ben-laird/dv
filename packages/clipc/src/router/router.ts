import { CliError } from "../errors.ts";
import type { FlagSpec, FlagsOf } from "../flag-spec.ts";
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

/**
 * A child registered in a router's `commands` map: either a nested
 * {@link RouterNode} (sub-router) or a {@link CommandNode} (leaf).
 * Both implement the same `CliHandler` protocol so dispatch is
 * uniform.
 */
export type RouterChild<Ctx> = RouterNode<Ctx> | CommandNode<Ctx>;

/**
 * A built router node in the tree (the value {@link router} returns).
 * Exposes its `children` for help generation and external tree
 * walkers, the declared `inheritedFlags` map for help rendering, and
 * the {@link CliHandler} the framework dispatches to. The
 * `kind: "router"` discriminator distinguishes it from a
 * `CommandNode`.
 */
export interface RouterNode<Ctx = unknown> {
  /** Discriminator marking this child as a sub-router (vs a `CommandNode`). */
  kind: "router";
  /** Optional description surfaced in help text. */
  description?: string;
  /**
   * The children, keyed by subcommand name. Help generation and external
   * tree walkers read this directly; dispatch reads it via `handler`.
   */
  children: Record<string, RouterChild<Ctx>>;
  /**
   * Cross-cutting flags this router declares as inherited, surfaced for
   * help rendering. Not auto-merged into children — see {@link inheritedFlags}.
   */
  inheritedFlags: Record<string, FlagSpec>;
  /**
   * The handler the framework dispatches to. Wraps the user's dispatch
   * logic (or the default one) and serves auto-generated help on
   * `--help` / no-subcommand.
   */
  handler: CliHandler<Ctx>;
}

/**
 * The author-facing definition of a router, passed to {@link router}.
 * `commands` maps subcommand names to children (sub-routers or
 * leaves); `inheritedFlags` declares cross-cutting flags descendants
 * may opt into (it does not auto-merge — see {@link inheritedFlags});
 * and the optional `run` hook lets a parent do pre-work before
 * delegating. Without `run`, the router uses built-in dispatch on the
 * first positional token.
 */
export interface RouterSpec<Ctx = unknown> {
  /** Optional one-line description shown in help text. */
  description?: string;
  /**
   * Cross-cutting flags declared as inherited by descendants. Not
   * auto-merged into child flag maps; callers explicitly spread them via
   * the {@link inheritedFlags} helper so each leaf only accepts what it
   * declares.
   */
  inheritedFlags?: Record<string, FlagSpec>;
  /** Subcommand names mapped to children (sub-routers or leaves). */
  commands: Record<string, RouterChild<Ctx>>;
  /**
   * Optional parent-with-logic hook. Receives the unconsumed argv and the
   * {@link DefaultDispatch} delegate, and must return a `Step`: call the
   * delegate to dispatch normally, return `done(...)` to short-circuit, or
   * return `next(...)` to do pre-work then delegate. Undefined uses the
   * built-in dispatch.
   */
  run?: (
    req: CliRequest<Ctx>,
    dispatch: DefaultDispatch<Ctx>,
  ) => Step<Ctx> | Promise<Step<Ctx>>;
}

// Helper passed to a parent's `run` so it can delegate to default
// behavior after doing its work. Encapsulates the child-lookup +
// argv-slice + ctx-passthrough so the parent doesn't reimplement
// it. The `ctxOverride` arg is the place to enrich ctx before the
// child sees it.
/**
 * The delegate handed to a router's `run` hook so it can fall back to
 * the built-in dispatch (child lookup + argv slice + ctx passthrough)
 * after doing its pre-work. Pass `ctxOverride` to enrich the ctx the
 * matched child receives.
 */
export type DefaultDispatch<Ctx> = (
  req: CliRequest<Ctx>,
  options?: { ctxOverride?: Ctx },
) => Step<Ctx>;

/**
 * Builds a router node that dispatches to one of its children by the
 * first positional argv token. Returns a {@link RouterNode}. Default
 * dispatch finds the subcommand name (skipping leading flags, which
 * ride along to the child), and either renders router help (`--help`
 * before the subcommand, or no subcommand at all), trampolines into
 * the matched child with the subcommand token stripped, or returns a
 * typed `unknown-subcommand` error (exit 2). If `spec.run` is
 * declared, it is invoked instead and may short-circuit with
 * `done(...)` or delegate via the supplied {@link DefaultDispatch}.
 * Throws if any child in `commands` is `undefined` (usually a bad
 * import).
 *
 * @param spec - The router definition: `commands`, optional
 *   `description`, optional `inheritedFlags`, and optional `run` hook.
 * @returns A {@link RouterNode} usable as a root or as another
 *   router's child.
 *
 * @example
 * ```ts
 * const pluginRouter = router<MyCtx>({
 *   description: "manage plugins",
 *   commands: { list: listCommand, install: installCommand },
 * });
 * const root = router<MyCtx>({ commands: { plugin: pluginRouter } });
 * ```
 */
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
          hint: `run '${req.path.join(
            " ",
          )} --help' to see available subcommands`,
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
/**
 * Identity helper for declaring a reusable map of cross-cutting flags
 * (e.g. `--json`, `--color`). The `const` type parameter captures
 * each flag's literal `kind`, so spreading the result into a leaf's
 * `flags` preserves per-flag narrowing. There is no magic
 * inheritance: callers explicitly spread the returned map into every
 * leaf that should accept those flags.
 *
 * @param flags - The literal flag-spec map to capture.
 * @returns The same map, with its literal type preserved.
 *
 * @example
 * ```ts
 * const shared = inheritedFlags({ json: { kind: "boolean" } });
 * const leaf = command<MyCtx>({
 *   flags: { ...shared, name: { kind: "string" } },
 *   run: ({ flags }) => done({ kind: "ok" }),
 * });
 * ```
 */
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

/**
 * The pair of Ctx-bound builders returned by {@link forCtx}: a
 * `command` and a `router` that have `Ctx` pre-applied so each
 * downstream call still infers its flag types from the literal
 * `flags` object.
 */
export interface CtxBoundBuilders<Ctx> {
  /**
   * Ctx-bound leaf builder. Infers `TFlags` from the literal `flags`
   * object while typing `req.ctx` as `Ctx`. Returns a {@link CommandNode}.
   */
  command: <const TFlags extends Record<string, FlagSpec>>(spec: {
    description?: string;
    flags: TFlags;
    run: (req: {
      flags: FlagsOf<TFlags>;
      argv: string[];
      ctx: Ctx;
      path: string[];
    }) => Step<Ctx> | Promise<Step<Ctx>>;
  }) => CommandNode<Ctx>;
  /** Ctx-bound router builder. Returns a {@link RouterNode}. */
  router: (spec: RouterSpec<Ctx>) => RouterNode<Ctx>;
}

/**
 * Returns a Ctx-bound pair of `command` and `router` builders.
 * Because TypeScript can't partially infer type parameters, naming
 * `Ctx` on every `command`/`router` call would force the flag map off
 * its literal type. Capturing `Ctx` in this closure lets each call
 * infer `TFlags` freely while still typing `req.ctx` as `Ctx`.
 *
 * @returns A {@link CtxBoundBuilders} object with `command` and
 *   `router` builders bound to `Ctx`.
 *
 * @example
 * ```ts
 * const { command, router } = forCtx<MyCtx>();
 * const leaf = command({
 *   flags: { json: { kind: "boolean" } },
 *   run: ({ flags, ctx }) => done({ kind: "ok" }),
 * });
 * const root = router({ commands: { leaf } });
 * ```
 */
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
