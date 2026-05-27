# @dv-cli/clipc

[![JSR](https://jsr.io/badges/@dv-cli/clipc)](https://jsr.io/@dv-cli/clipc)
[![JSR Score](https://jsr.io/badges/@dv-cli/clipc/score)](https://jsr.io/@dv-cli/clipc)

**CLIPC** — Command Line Interface Procedure Call. A typed CLI
framework: routers, leaves, flag specs, and structured error
responses. The substrate [dv](https://jsr.io/@dv-cli/dv) is built on,
extracted so other Deno CLIs can reuse it.

## Install

```sh
deno add jsr:@dv-cli/clipc
```

## Use

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

## What you get

- **Typed routers + leaves** with full TS narrowing on flags + ctx
- **Structured error responses** (the `CliError` discriminated union)
  with a versioned JSON envelope for machine consumers
- **Errors-as-values** — leaves return `{kind: "ok" | "error" | "help"}`
  rather than throwing; the framework renders them
- **Built-in help** — `--help` at every level of the router tree

## Repository

Source lives in
[ben-laird/dv](https://github.com/ben-laird/dv/tree/main/packages/clipc).
MIT licensed.
