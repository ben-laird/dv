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
  code. Each flag declares its `kind` (`string`, `boolean`, `collect`,
  `optional-value`) and description;
  the framework derives parsing, `--help` text, and the static `FlagsOf<…>` type
  from one declaration. A value-carrying flag can name its value for `--help`:
  `{ kind: "string", valueName: "path" }` shows `--out <path>` instead of the
  default `--out <string>`, and can take a Standard Schema `schema` that
  validates and types its value. `inheritedFlags` is a typed-identity capture: declare a
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

**Words stay words.** A leaf receives each positional exactly as typed, so
`mycli add 007` hands it `"007"`, never `7`; a leaf that wants a number parses
its own. Everything after `--` is a positional word, never a switch:
`mycli add -- --help` passes `--help` to the leaf instead of printing help.
A lone `-` is a word too (by convention it often means stdin): `mycli add -`
hands the leaf `"-"`, and `--title -` sets `title` to `"-"`, as `-t -` and
`--title=-` do.

**Switches with an optional value.** An `optional-value` flag is a switch that
may also carry a value, attached with `=`:

```typescript
flags: {
  askOnCommit: {
    kind: "optional-value",
    choices: ["null"],
    booleans: true,
    description: "Ask before each commit (=null resets to the default)",
  },
}
// --askOnCommit        → true
// --no-askOnCommit     → false
// --askOnCommit=true   → true
// --askOnCommit=false  → false
// --askOnCommit=null   → "null"
// (absent)             → undefined
```

What may follow `=` is a small vocabulary. `choices` closes the set to those
literals, and `flags.askOnCommit` is typed `boolean | "null" | undefined`;
leave it out and any attached string is accepted, typed `string`.
`booleans: true` also reads `=true` / `=false` as booleans, the way a boolean
flag reads `--json=false`. The value must be attached: `--askOnCommit null`
switches the flag on and leaves `null` as a positional word. A value outside
the declared set (`--askOnCommit=foo`) is refused with an `invalid-flag-value`
error and exit 2.

`--help` lists every accepted spelling: `--askOnCommit[=true|false|null]`, or
`--label[=<string>]` for a free value. A `valueName` replaces the list
(`--askOnCommit[=<setting>]`), which hides a closed set, so leave it unset when
the set is short. The flag takes no short `alias`.

`command()` throws when the tree is built if the declaration contradicts
itself:

- a separate `no-askOnCommit` flag beside it, since `--no-askOnCommit` already
  means `false` (drop the separate flag);
- an optional-value flag named `no-<y>` beside a declared `<y>`, whose
  negation that name would shadow (rename the optional-value flag);
- `"true"` or `"false"` in `choices` together with `booleans: true`, since
  those spellings already read as booleans (drop them from `choices`).

**Typed values with a schema.** A `string`, `collect` or `optional-value` flag
can take a `schema`: any [Standard Schema](https://standardschema.dev), such as
Zod 4, Valibot or ArkType. clipc vendors the spec's types, so it takes no
dependency. Each value typed is validated before `run`, and `run` sees the
schema's output:

```typescript
import { z } from "zod";

flags: {
  jobs: { kind: "string", schema: z.coerce.number().int().positive() },
  port: { kind: "collect", schema: z.coerce.number() },
  color: {
    kind: "optional-value",
    schema: z.enum(["always", "never", "auto"]),
    booleans: true,
  },
}
// flags.jobs  → number | undefined
// flags.port  → number[] | undefined (each element validated)
// flags.color → boolean | "always" | "never" | "auto" | undefined
```

argv holds only text, so a schema must take a string input:
`z.coerce.number()` and `z.enum([...])` type-check, while `z.number()` is a
type error at `command()`. Lexing stays synchronous and validation is a
separate, awaited step, so sync and async schemas both work. A flag left out
is not validated, and `--help` returns before anything is validated.

A refused value is an `invalid-flag-value` error with exit 2, carrying the
schema's messages: `invalid value 'x' for '--jobs': Invalid input: expected
number, received NaN`. A `collect` flag names the refused element by place,
`--port #2`. Errors come in argv order. A schema that fails with no issues
reads as `the value was refused`. A schema that throws is reported the same
way, as `the flag's schema threw: <message>`, and doesn't crash the CLI.

On an `optional-value` flag, `schema` and `choices` exclude each other, and
the types enforce it. `booleans: true` composes with either: `=true` and
`=false` read as booleans before the schema sees them.

Any library that implements the spec works. `@sekhmet/schema`, for one, turns
its schemas into Standard Schemas with `toStandard`, and the result goes
straight into `schema`.

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
