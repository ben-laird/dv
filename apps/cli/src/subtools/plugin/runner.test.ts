import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import { invokeOp } from "./runner.ts";

// Targeted integration test for invokeOp's `invocation` kind —
// the spawn path the `run:` plugin reference produces. The
// `single` and `dir` kinds are covered indirectly by every other
// integration test that uses a path-based fixture plugin; the
// invocation kind has no equivalent coverage and ships a new
// argv-construction branch in the runner.
//
// Strategy: build a tiny bash wrapper that calls a Deno script
// with `-A`, mimicking what a Sekhmet-style `run:` reference
// would resolve to. The wrapper echoes back its argv so the test
// can assert exactly what dv passed through.

interface WithEchoPluginArgs {
  testBody: (args: {
    binDirectory: string;
    pluginScriptPath: string;
  }) => Promise<void>;
}

async function withEchoPlugin(args: WithEchoPluginArgs): Promise<void> {
  // Set up a temp dir containing:
  //   ./bash-runner       — wrapper that calls deno on the Deno
  //                         script, forwarding all argv
  //   ./echo-argv.ts      — Deno script that prints argv as JSON
  const binDirectory = await Deno.makeTempDir({
    prefix: "dv-runner-invocation-",
  });
  const denoScriptPath = join(binDirectory, "echo-argv.ts");
  await Deno.writeTextFile(
    denoScriptPath,
    `// Echoes the argv it received as a JSON array — used to verify
// the invocation-kind runner forwards [...baseArgs, opName].
console.log(JSON.stringify({ argv: Deno.args }));
`,
  );

  try {
    await args.testBody({
      binDirectory,
      pluginScriptPath: denoScriptPath,
    });
  } finally {
    await Deno.remove(binDirectory, { recursive: true });
  }
}

Deno.test("invokeOp invocation-kind: spawns the executable with [...baseArgs, opName]", async () => {
  await withEchoPlugin({
    testBody: async ({ pluginScriptPath }) => {
      // Given an 'invocation' ResolvedPlugin pointing at `deno`
      // with the static args ["run", "-A", <script>]
      const resolvedPlugin: ResolvedPlugin = {
        kind: "invocation",
        path: `deno run -A ${pluginScriptPath}`,
        executable: "deno",
        baseArgs: ["run", "-A", pluginScriptPath],
      };

      // When invokeOp runs with opName "discover"
      const { rawStdout } = await invokeOp({
        resolvedPlugin,
        opName: "discover",
      });

      // Then the spawned process received baseArgs + opName as
      // argv — the echo script writes them back as JSON so we
      // can confirm the order and contents.
      const parsed = JSON.parse(rawStdout.trim()) as { argv: string[] };
      assertEquals(parsed.argv, ["discover"]);
    },
  });
});

Deno.test("invokeOp invocation-kind: DV_OPERATION env var still rides along", async () => {
  await withEchoPlugin({
    testBody: async ({ binDirectory, pluginScriptPath: _pluginScriptPath }) => {
      // Given a Deno script that prints DV_OPERATION instead of argv
      // (we write our own script in this test rather than using the
      // default echo-argv one)
      const opEchoScript = join(binDirectory, "echo-op.ts");
      await Deno.writeTextFile(
        opEchoScript,
        `console.log(JSON.stringify({ op: Deno.env.get("DV_OPERATION") }));\n`,
      );
      const resolvedPlugin: ResolvedPlugin = {
        kind: "invocation",
        path: `deno run -A ${opEchoScript}`,
        executable: "deno",
        baseArgs: ["run", "-A", opEchoScript],
      };

      // When invokeOp runs
      const { rawStdout } = await invokeOp({
        resolvedPlugin,
        opName: "read-version",
      });

      // Then DV_OPERATION carries the op name — the invocation
      // kind doesn't bypass the env-var contract that single/dir
      // kinds honor; downstream plugin code can read it either way
      const parsed = JSON.parse(rawStdout.trim()) as { op: string };
      assertEquals(parsed.op, "read-version");
      // Also tidy up the second script we made
      await Deno.remove(opEchoScript);
    },
  });
});
