# @dv-cli/clipc

[![JSR](https://jsr.io/badges/@dv-cli/clipc)](https://jsr.io/@dv-cli/clipc)
[![JSR Score](https://jsr.io/badges/@dv-cli/clipc/score)](https://jsr.io/@dv-cli/clipc)

**CLIPC** — Command Line Interface Procedure Call. A typed CLI framework for
Deno: a tree of routers and leaves, declarative flag specs, and structured
error responses. The framework owns argv parsing, dispatch, help generation,
and error rendering; you write the leaves. It is the substrate
[dv](https://jsr.io/@dv-cli/dv) is built on, extracted so other Deno CLIs can
reuse it.

## Install

```sh
deno add jsr:@dv-cli/clipc
```

## Quick start

```typescript
import { defineCli, forCtx, done } from "@dv-cli/clipc";

interface MyCtx { binaryArgv: string[] }
const { command, router } = forCtx<MyCtx>();

const helloLeaf = command({
  description: "Say hello",
  flags: {
    name: { kind: "string", description: "Who to greet" },
  },
  run: async ({ flags }) => {
    console.log(`Hello, ${flags.name ?? "world"}`);
    return done({ kind: "ok" });
  },
});

const root = router({
  description: "My CLI",
  commands: { hello: helloLeaf },
});

const cli = defineCli<MyCtx>({
  name: "mycli",
  version: "0.1.0",
  rootRouter: root,
  makeContext: () => ({ binaryArgv: Deno.args }),
});

if (import.meta.main) Deno.exit(await cli.run(Deno.args));
```

## Core concepts

clipc is five ideas. Once you have them, the whole surface follows.

- **Typed routers** (`router`) — interior nodes of the command tree. A router
  maps subcommand names to children (leaves or nested routers) and contributes
  `--help` at its level. Nesting routers gives you `mycli plugin verify`-style
  command paths with no manual argv slicing.
- **Typed leaves** (`command`) — the executable tips of the tree. A leaf
  declares its flags and a `run` handler. Flag types flow through to `run`'s
  `flags` argument, so `flags.name` is a `string | undefined`, not `any` — the
  compiler enforces the contract you declared.
- **Flag specs** (`FlagSpec`, `lowerFlagSpec`) — flags are data, not parsing
  code. Each flag declares its `kind` (`string`, `boolean`, …) and description;
  the framework derives parsing, `--help` text, and the static `FlagsOf<…>` type
  from one declaration. `inheritedFlags` is a typed-identity capture: declare a
  shared flag map once, then spread it into each leaf's `flags` so cross-cutting
  flags keep one source of truth without drifting per-flag kinds.
- **Errors-as-values** (`done`, `next`, `Step`) — handlers return a result
  (`{ kind: "ok" | "error" | "help" }`) rather than throwing. `done` ends
  dispatch; `next` hands control to a child. The framework renders the outcome
  and picks the exit code, so control flow stays explicit and testable.
- **Structured errors** (`CliError`, `renderCliError`, `parseCliErrorEnvelope`)
  — a discriminated-union error type with a **versioned JSON envelope**. Humans
  get a formatted message; `--json` consumers get a stable shape they can parse
  with `parseCliErrorEnvelope` (Zod-free results). Extend `CliError` with your
  own `CliErrorShape` for typed narrowing at catch sites.

**Built-in help** falls out of the above: `--help` works at every level of the
tree, formatted from the same flag specs and descriptions you already wrote
(`formatRouterHelp`, `formatCommandHelp`).

## A larger example

Nested routers, a shared flag spread into a leaf, and a structured error:

```typescript
import { defineCli, forCtx, done, inheritedFlags, CliError } from "@dv-cli/clipc";

interface Ctx { cwd: string }
const { command, router } = forCtx<Ctx>();

// Declare cross-cutting flags once; spread them into any leaf that opts in.
const sharedFlags = inheritedFlags({
  verbose: { kind: "boolean", description: "Chatty output" },
});

const build = command({
  description: "Build the project",
  flags: {
    ...sharedFlags,
    release: { kind: "boolean", description: "Optimized build" },
  },
  run: async ({ flags }) => {
    // `flags.verbose` and `flags.release` are both typed booleans here.
    if (flags.release && !flags.verbose) {
      return done({
        kind: "error",
        error: new CliError({
          code: "needs-verbose",
          message: "use --verbose for release builds",
        }),
      });
    }
    console.log(flags.release ? "release build" : "dev build");
    return done({ kind: "ok" });
  },
});

const project = router({ description: "Project commands", commands: { build } });
const root = router({ description: "My tool", commands: { project } });

const cli = defineCli<Ctx>({
  name: "mytool",
  version: "1.0.0",
  rootRouter: root,
  makeContext: () => ({ cwd: Deno.cwd() }),
});

// mytool project build --release --verbose
if (import.meta.main) Deno.exit(await cli.run(Deno.args));
```

## When to use clipc

Reach for clipc when you are building a Deno CLI that wants **typed routing,
declarative flags, and a machine-readable error contract** without hand-rolling
argv parsing and help text. It is deliberately small and unopinionated about
everything else: no config loading, no logging, no plugin system — just the
command tree and its dispatch.

If you only need to parse a flat set of flags, `@std/cli`'s `parseArgs` is
lighter. clipc earns its keep once you have nested subcommands, want flag types
to flow into handlers, or need a stable `--json` error envelope for other tools
(or agents) to consume.

## Repository

Source lives in
[ben-laird/dv](https://github.com/ben-laird/dv/tree/main/packages/clipc). For a
real-world consumer, read how
[dv](https://github.com/ben-laird/dv/tree/main/apps/cli/src/cli) wires its
command tree on top of clipc. MIT licensed.
