import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import { invokeOp } from "./runner.ts";
import type {
  InvocationFailure,
  InvocationOutcome,
  InvocationTrace,
  TracingHooks,
} from "./tracing.ts";

// Validates the tracing-hooks contract that powers `--debug`.
// The runner promises: hooks fire in order (before then after for
// success; before then error for failure) with the trace shape
// the dv layer can rely on. Tested via a path-kind fixture that
// either succeeds or fails on demand — exercising the runner's
// real spawn path keeps the test honest about ordering.

interface RecordedEvent {
  kind: "before" | "after" | "error";
  trace: InvocationTrace;
  outcome?: InvocationOutcome;
  failure?: InvocationFailure;
}

function makeRecordingHooks(events: RecordedEvent[]): TracingHooks {
  return {
    before(trace) {
      events.push({ kind: "before", trace });
    },
    after(trace, outcome) {
      events.push({ kind: "after", trace, outcome });
    },
    error(trace, failure) {
      events.push({ kind: "error", trace, failure });
    },
  };
}

interface WithPluginArgs {
  pluginBody: string;
  testBody: (args: { pluginPath: string }) => Promise<void>;
}

async function withPlugin(args: WithPluginArgs): Promise<void> {
  const tempDirectory = await Deno.makeTempDir({
    prefix: "dv-tracing-test-",
  });
  const pluginPath = join(tempDirectory, "plugin.sh");
  await Deno.writeTextFile(pluginPath, args.pluginBody);
  await Deno.chmod(pluginPath, 0o755);
  try {
    await args.testBody({ pluginPath });
  } finally {
    await Deno.remove(tempDirectory, { recursive: true });
  }
}

Deno.test("tracing hooks fire before then after on success, carrying the invocation trace", async () => {
  // Given a plugin that exits 0 with a known stdout payload
  await withPlugin({
    pluginBody: `#!/usr/bin/env bash
echo '{"version":"1.2.3"}'
`,
    testBody: async ({ pluginPath }) => {
      const recordedEvents: RecordedEvent[] = [];
      const resolvedPlugin: ResolvedPlugin = {
        kind: "single",
        path: pluginPath,
      };

      // When invokeOp runs with recording tracing hooks
      const result = await invokeOp({
        resolvedPlugin,
        opName: "read-version",
        environmentVariables: { DV_PACKAGE_NAME: "foo" },
        tracingHooks: makeRecordingHooks(recordedEvents),
      });

      // Then exactly two events fire, in order: before then after
      assertEquals(recordedEvents.length, 2);
      assertEquals(recordedEvents[0]?.kind, "before");
      assertEquals(recordedEvents[1]?.kind, "after");

      // And the trace describes the invocation dv actually spawned
      const beforeTrace = recordedEvents[0]?.trace;
      assertEquals(beforeTrace?.opName, "read-version");
      assertEquals(beforeTrace?.executablePath, pluginPath);
      assertEquals(beforeTrace?.executableArgv, ["read-version"]);
      assertEquals(beforeTrace?.environmentVariables.DV_PACKAGE_NAME, "foo");
      assertEquals(
        beforeTrace?.environmentVariables.DV_OPERATION,
        "read-version",
      );

      // And the after outcome carries the captured streams and exit code
      const afterOutcome = recordedEvents[1]?.outcome;
      assertEquals(afterOutcome?.exitCode, 0);
      assertEquals(afterOutcome?.rawStdout, result.rawStdout);
    },
  });
});

Deno.test("tracing hooks fire before then error when the plugin exits non-zero", async () => {
  // Given a plugin that writes to stderr and exits non-zero
  await withPlugin({
    pluginBody: `#!/usr/bin/env bash
echo "something broke" >&2
exit 3
`,
    testBody: async ({ pluginPath }) => {
      const recordedEvents: RecordedEvent[] = [];
      const resolvedPlugin: ResolvedPlugin = {
        kind: "single",
        path: pluginPath,
      };

      // When invokeOp runs and the plugin fails
      let caught: unknown;
      try {
        await invokeOp({
          resolvedPlugin,
          opName: "discover",
          tracingHooks: makeRecordingHooks(recordedEvents),
        });
      } catch (caughtError) {
        caught = caughtError;
      }

      // Then before fires once and error fires once, before throwing
      assertEquals(recordedEvents.length, 2);
      assertEquals(recordedEvents[0]?.kind, "before");
      assertEquals(recordedEvents[1]?.kind, "error");
      assertEquals(
        recordedEvents[1]?.failure?.errorCode,
        "plugin-exit-nonzero",
      );
      assertEquals(
        recordedEvents[1]?.failure?.rawStderr.includes("something broke"),
        true,
      );
      // And the runner still throws, so the caller's normal error
      // handling kicks in alongside the trace
      assertEquals(caught instanceof Error, true);
    },
  });
});

Deno.test("tracing hooks fire error when the plugin executable is not found", async () => {
  // Given a path that does not exist
  const recordedEvents: RecordedEvent[] = [];
  const resolvedPlugin: ResolvedPlugin = {
    kind: "single",
    path: "/tmp/dv-tracing-test-does-not-exist",
  };

  // When invokeOp tries to spawn it
  let caught: unknown;
  try {
    await invokeOp({
      resolvedPlugin,
      opName: "discover",
      tracingHooks: makeRecordingHooks(recordedEvents),
    });
  } catch (caughtError) {
    caught = caughtError;
  }

  // Then the before fires (we already snapshotted the trace) and
  // an error fires with the not-executable code — no after
  assertEquals(
    recordedEvents.map((event) => event.kind),
    ["before", "error"],
  );
  assertEquals(recordedEvents[1]?.failure?.errorCode, "plugin-not-executable");
  assertEquals(caught instanceof Error, true);
});
