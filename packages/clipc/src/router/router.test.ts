import { assertEquals, assertStringIncludes } from "@std/assert";
import { CliError } from "../errors.ts";
import { command } from "./command.ts";
import { defineCli, type OutputMode } from "./define-cli.ts";
import { router } from "./router.ts";
import { type CliResponse, done, next } from "./types.ts";

// Framework tests for the router + trampoline pipeline. Built
// around synthetic command trees so the contract is exercised
// without leaking dv-domain concerns into the framework's tests.
//
// Test taxonomy:
//   - dispatch: leaf invocation, sub-router, unknown subcommand,
//     no-arg → auto-help
//   - trampoline: parent-with-logic runs before child; ctx
//     enrichment travels via next(); path breadcrumb extends
//   - help: --help on a leaf, --help on a router (auto-generated
//     from children), no-arg routes to help
//   - errors: typed (returned) vs thrown (degraded path) — both
//     surface but the framework treats them differently
//   - render: ok/json output, error output, exit codes

interface CapturedRun {
  stdoutLines: string[];
  stderrLines: string[];
  exitCode: number;
}

async function runWithCapture<Ctx>(args: {
  rootRouter: ReturnType<typeof router<Ctx>>;
  argv: string[];
  ctx?: Ctx;
  outputMode?: OutputMode;
}): Promise<CapturedRun> {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  console.log = (...parts: unknown[]) => {
    stdoutLines.push(parts.map((p) => String(p)).join(" "));
  };
  console.error = (...parts: unknown[]) => {
    stderrLines.push(parts.map((p) => String(p)).join(" "));
  };
  try {
    const cli = defineCli<Ctx>({
      name: "test-cli",
      version: "0.0.1",
      rootRouter: args.rootRouter,
      makeContext: () => args.ctx ?? ({} as Ctx),
      resolveOutputMode: () =>
        args.outputMode ?? { emitJson: false, colorEnabled: false },
    });
    const exitCode = await cli.run(args.argv);
    return { stdoutLines, stderrLines, exitCode };
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
}

Deno.test("router dispatches a leaf command and returns its CliResponse", async () => {
  // Given a tree with one leaf
  const root = router({
    commands: {
      hello: command({
        description: "say hi",
        flags: {},
        run: () => done({ kind: "ok", stdout: "hello world" }),
      }),
    },
  });

  // When the user runs `test-cli hello`
  const result = await runWithCapture({ rootRouter: root, argv: ["hello"] });

  // Then the leaf's stdout is printed and exit is 0
  assertEquals(result.exitCode, 0);
  assertEquals(result.stdoutLines, ["hello world"]);
});

Deno.test("router dispatches into a sub-router, then into its leaf", async () => {
  // Given a 2-level tree: test-cli → plugin → list
  const root = router({
    commands: {
      plugin: router({
        commands: {
          list: command({
            flags: {},
            run: ({ path }) =>
              done({ kind: "ok", stdout: `path: ${path.join(" / ")}` }),
          }),
        },
      }),
    },
  });

  // When the user runs `test-cli plugin list`
  const result = await runWithCapture({
    rootRouter: root,
    argv: ["plugin", "list"],
  });

  // Then the leaf runs, sees the breadcrumb extended through both
  // hops, and prints it
  assertEquals(result.exitCode, 0);
  assertEquals(result.stdoutLines, ["path: test-cli / plugin / list"]);
});

Deno.test("router with its own `run` enriches ctx before delegating via next()", async () => {
  // Given a parent router that loads a value into ctx, and a leaf
  // that reads it. This is the trampoline's main value-add: parents
  // declare logic, not just structure.
  interface SharedCtx {
    enrichedBy?: string;
  }
  const childLeaf = command<SharedCtx>({
    flags: {},
    run: ({ ctx }) =>
      done({ kind: "ok", stdout: `child sees: ${ctx.enrichedBy ?? "<none>"}` }),
  });
  const parentRouter = router<SharedCtx>({
    commands: { child: childLeaf },
    run: (req, dispatch) => {
      // Parent does pre-work and enriches ctx for the child.
      const enrichedCtx: SharedCtx = { enrichedBy: "parent-router" };
      return dispatch(req, { ctxOverride: enrichedCtx });
    },
  });
  const root = router<SharedCtx>({
    commands: { parent: parentRouter },
  });

  // When the user runs `test-cli parent child`
  const result = await runWithCapture({
    rootRouter: root,
    argv: ["parent", "child"],
    ctx: {} satisfies SharedCtx,
  });

  // Then the child sees the enriched ctx the parent set
  assertEquals(result.exitCode, 0);
  assertEquals(result.stdoutLines, ["child sees: parent-router"]);
});

Deno.test("router returns help text (auto-generated from children) when invoked with no subcommand", async () => {
  // Given a router with three children
  const root = router({
    commands: {
      apple: command({
        description: "the apple command",
        flags: {},
        run: () => done({ kind: "ok" }),
      }),
      banana: command({
        description: "the banana command",
        flags: {},
        run: () => done({ kind: "ok" }),
      }),
      cherry: command({
        description: "the cherry command",
        flags: {},
        run: () => done({ kind: "ok" }),
      }),
    },
  });

  // When the user runs `test-cli` (no subcommand)
  const result = await runWithCapture({ rootRouter: root, argv: [] });

  // Then the auto-generated help lists all three children, sorted
  assertEquals(result.exitCode, 0);
  const helpText = result.stdoutLines.join("\n");
  assertStringIncludes(helpText, "Usage: test-cli <subcommand>");
  assertStringIncludes(helpText, "apple");
  assertStringIncludes(helpText, "banana");
  assertStringIncludes(helpText, "cherry");
  assertStringIncludes(helpText, "the apple command");
  // Sort check: apple appears before banana in the rendered text
  const appleIndex = helpText.indexOf("apple");
  const bananaIndex = helpText.indexOf("banana");
  assertEquals(appleIndex < bananaIndex, true);
});

Deno.test("router help previews grandchildren under each sub-router on a continuation line", async () => {
  // Given a tree where one child is a sub-router with its own
  // children — readers shouldn't have to descend to learn what's
  // there.
  const root = router({
    commands: {
      leaf: command({
        description: "a plain leaf",
        flags: {},
        run: () => done({ kind: "ok" }),
      }),
      compound: router({
        description: "a sub-router with children",
        commands: {
          alpha: command({ flags: {}, run: () => done({ kind: "ok" }) }),
          beta: command({ flags: {}, run: () => done({ kind: "ok" }) }),
        },
      }),
    },
  });

  // When the user asks for top-level help
  const result = await runWithCapture({ rootRouter: root, argv: [] });

  // Then the sub-router's children are listed on a continuation
  // line under it, with the ↳ arrow marker and the child names
  // separated by two spaces so each reads as its own token.
  assertEquals(result.exitCode, 0);
  const helpText = result.stdoutLines.join("\n");
  assertStringIncludes(helpText, "compound");
  assertStringIncludes(helpText, "a sub-router with children");
  assertStringIncludes(helpText, "↳ alpha  beta");
  // The leaf row does NOT get a continuation line (leaves have
  // flags, not children — that lives in `leaf --help`).
  const leafLine = result.stdoutLines.find((line) =>
    line.includes("a plain leaf"),
  );
  assertEquals(leafLine !== undefined, true);
});

Deno.test("router returns help on --help even when a subcommand would have matched", async () => {
  // Given a tree where --help comes before any valid subcommand
  const root = router({
    commands: {
      hello: command({
        flags: {},
        run: () => done({ kind: "ok", stdout: "leaf ran" }),
      }),
    },
  });

  // When the user runs `test-cli --help`
  const result = await runWithCapture({ rootRouter: root, argv: ["--help"] });

  // Then help renders, the leaf does NOT run
  assertEquals(result.exitCode, 0);
  assertEquals(
    result.stdoutLines.some((line) => line.includes("leaf ran")),
    false,
  );
  assertStringIncludes(result.stdoutLines.join("\n"), "Subcommands:");
});

Deno.test("leaf returns help on --help with its flag spec rendered", async () => {
  // Given a leaf with a couple of flags
  const root = router({
    commands: {
      build: command({
        description: "build the thing",
        flags: {
          target: { kind: "string", description: "build target" },
          verbose: { kind: "boolean", alias: "v" },
        },
        run: () => done({ kind: "ok" }),
      }),
    },
  });

  // When the user runs `test-cli build --help`
  const result = await runWithCapture({
    rootRouter: root,
    argv: ["build", "--help"],
  });

  // Then the leaf's flags appear in the help text
  assertEquals(result.exitCode, 0);
  const helpText = result.stdoutLines.join("\n");
  assertStringIncludes(helpText, "Usage: test-cli build");
  assertStringIncludes(helpText, "build the thing");
  assertStringIncludes(helpText, "--target");
  assertStringIncludes(helpText, "--verbose");
  assertStringIncludes(helpText, "build target");
});

Deno.test("router returns kind:error with exit 2 for an unknown subcommand", async () => {
  // Given a router with a known subcommand
  const root = router({
    commands: {
      hello: command({ flags: {}, run: () => done({ kind: "ok" }) }),
    },
  });

  // When the user runs `test-cli bogus`
  const result = await runWithCapture({ rootRouter: root, argv: ["bogus"] });

  // Then the error renders to stderr with exit 2
  assertEquals(result.exitCode, 2);
  const stderrText = result.stderrLines.join("\n");
  assertStringIncludes(stderrText, "unknown-subcommand");
  assertStringIncludes(stderrText, "bogus");
});

Deno.test("leaf returns kind:error with exit 2 for an unknown flag (typed error path)", async () => {
  // Given a leaf with one declared flag
  const root = router({
    commands: {
      hello: command({
        flags: { name: { kind: "string" } },
        run: () => done({ kind: "ok" }),
      }),
    },
  });

  // When the user passes an undeclared flag
  const result = await runWithCapture({
    rootRouter: root,
    argv: ["hello", "--bogus"],
  });

  // Then the framework reports it as a typed error (not a throw)
  assertEquals(result.exitCode, 2);
  const stderrText = result.stderrLines.join("\n");
  assertStringIncludes(stderrText, "unknown-flag");
  assertStringIncludes(stderrText, "--bogus");
});

Deno.test("driver wraps a thrown error into kind:error with code:unknown (degraded path)", async () => {
  // Given a leaf that throws a non-CliError. This is the bug-path:
  // typed runners return errors; throws degrade gracefully.
  const root = router({
    commands: {
      explode: command({
        flags: {},
        run: () => {
          throw new Error("kaboom");
        },
      }),
    },
  });

  // When the user runs `test-cli explode`
  const result = await runWithCapture({ rootRouter: root, argv: ["explode"] });

  // Then the throw is caught and rendered, exit defaults to 1
  assertEquals(result.exitCode, 1);
  const stderrText = result.stderrLines.join("\n");
  assertStringIncludes(stderrText, "unknown");
  assertStringIncludes(stderrText, "kaboom");
});

Deno.test("driver passes a thrown CliError through verbatim (preserves typed shape)", async () => {
  // Given a leaf that throws a typed CliError. Throws are still the
  // degraded path, but if the thing thrown IS a CliError, the
  // framework keeps the typed shape rather than wrapping it as
  // `unknown` — useful for code that calls into shared libraries
  // that throw DvError today.
  const root = router({
    commands: {
      typed: command({
        flags: {},
        run: () => {
          throw new CliError({
            code: "domain-specific",
            message: "specifically this",
            hint: "do that",
          });
        },
      }),
    },
  });

  // When the user runs `test-cli typed`
  const result = await runWithCapture({ rootRouter: root, argv: ["typed"] });

  // Then the rendered error carries the original code, not 'unknown'
  assertEquals(result.exitCode, 1);
  const stderrText = result.stderrLines.join("\n");
  assertStringIncludes(stderrText, "domain-specific");
  assertStringIncludes(stderrText, "specifically this");
});

Deno.test("leaf returning kind:ok with json + emitJson=true serializes JSON", async () => {
  // Given a leaf that returns structured data and a run with
  // emitJson mode
  const root = router({
    commands: {
      info: command({
        flags: {},
        run: () => done({ kind: "ok", json: { hello: "world" } }),
      }),
    },
  });

  // When the framework runs with emitJson:true
  const result = await runWithCapture({
    rootRouter: root,
    argv: ["info"],
    outputMode: { emitJson: true, colorEnabled: false },
  });

  // Then the JSON is serialized to stdout
  assertEquals(result.exitCode, 0);
  const stdoutText = result.stdoutLines.join("\n");
  const parsed = JSON.parse(stdoutText) as { hello: string };
  assertEquals(parsed.hello, "world");
});

Deno.test("leaf returning kind:ok with exitCode honors it", async () => {
  // Given a leaf that returns a non-zero exit on a non-error path
  // (e.g. dv validate finding lint issues)
  const root = router({
    commands: {
      noisy: command({
        flags: {},
        run: () =>
          done({
            kind: "ok",
            exitCode: 1,
            stdout: "we're ok, but exit is 1 by design",
          }),
      }),
    },
  });

  // When the user runs it
  const result = await runWithCapture({ rootRouter: root, argv: ["noisy"] });

  // Then exit 1 propagates without going through the error renderer
  assertEquals(result.exitCode, 1);
  assertEquals(result.stderrLines.length, 0);
  assertEquals(result.stdoutLines, ["we're ok, but exit is 1 by design"]);
});

Deno.test("--version at the top level prints the version and exits 0", async () => {
  const root = router({
    commands: {
      hello: command({ flags: {}, run: () => done({ kind: "ok" }) }),
    },
  });
  const result = await runWithCapture({
    rootRouter: root,
    argv: ["--version"],
  });
  assertEquals(result.exitCode, 0);
  assertEquals(result.stdoutLines, ["0.0.1"]);
});

Deno.test("trampoline aborts with kind:error if a parent next()s back to itself (cycle protection)", async () => {
  // Given a buggy parent that always trampolines into itself. The
  // driver should detect the runaway and surface it as an error
  // rather than spinning forever.
  type SelfRef =
    | { self: { handler: typeof selfHandler } }
    | Record<string, never>;
  const selfHandler: import("./types.ts").CliHandler<SelfRef> = (req) =>
    next({
      handler: selfHandler,
      argv: req.argv,
      ctx: req.ctx,
      subcommandName: "self",
    });
  const root = router<SelfRef>({
    commands: {
      loop: { kind: "command", handler: selfHandler, flags: {} },
    },
  });

  // When the user runs `test-cli loop`
  const result = await runWithCapture({
    rootRouter: root,
    argv: ["loop"],
    ctx: {},
  });

  // Then the trampoline trips the runaway guard and reports it
  assertEquals(result.exitCode, 1);
  const stderrText = result.stderrLines.join("\n");
  assertStringIncludes(stderrText, "trampoline-runaway");
});

// Sanity: CliResponse is exported as a type and constructable via
// done/next. Compile-time assertion that the public surface is
// reachable without a kitchen-sink import path.
const _typeExportCheck: CliResponse = { kind: "ok" };
void _typeExportCheck;
