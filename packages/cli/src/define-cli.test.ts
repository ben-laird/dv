import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CliConfig, CommandSpec } from "./command-spec.ts";
import { defineCli } from "./define-cli.ts";

// Test helper — captures console.log and console.error during one
// dispatch invocation. Stubbing the globals matches the apps/cli test
// style and keeps the framework's runner-context shape minimal (no
// injected writers).
interface CapturedOutput {
  stdout: string;
  stderr: string;
}

async function captureConsole<T>(
  action: () => Promise<T>,
): Promise<{ result: T; captured: CapturedOutput }> {
  const originalLog = console.log;
  const originalError = console.error;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  console.log = (...parts: unknown[]) => {
    stdoutLines.push(parts.map((p) => String(p)).join(" "));
  };
  console.error = (...parts: unknown[]) => {
    stderrLines.push(parts.map((p) => String(p)).join(" "));
  };
  try {
    const result = await action();
    return {
      result,
      captured: { stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n") },
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

// Tiny config helper — most tests share name/version/usage.
function buildConfig(args: {
  commands: Record<string, CommandSpec>;
  reportError?: (caughtError: unknown) => void;
}): CliConfig {
  return {
    name: "tst",
    version: "1.2.3",
    usage: "Usage: tst <command>",
    commands: args.commands,
    reportError: args.reportError,
  };
}

Deno.test("defineCli prints top-level help when argv is empty", async () => {
  // Given a CLI with one no-op command
  const cli = defineCli(
    buildConfig({
      commands: {
        status: { flags: {}, usage: "Usage: tst status", run: () => 0 },
      },
    }),
  );

  // When run is called with no argv
  const { result, captured } = await captureConsole(() => cli.run([]));

  // Then the top-level usage text appears on stdout and exit code is 0
  assertEquals(result, 0);
  assertStringIncludes(captured.stdout, "Usage: tst <command>");
});

Deno.test("defineCli prints top-level help when --help appears first", async () => {
  // Given a CLI with one command
  const cli = defineCli(
    buildConfig({
      commands: {
        status: { flags: {}, usage: "Usage: tst status", run: () => 0 },
      },
    }),
  );

  // When --help is the first argv token
  const { result, captured } = await captureConsole(() =>
    cli.run(["--help"]),
  );

  // Then top-level help renders and the runner is not invoked
  assertEquals(result, 0);
  assertStringIncludes(captured.stdout, "Usage: tst <command>");
});

Deno.test("defineCli prints the configured version on --version", async () => {
  // Given a CLI with version 1.2.3
  const cli = defineCli(
    buildConfig({
      commands: {
        status: { flags: {}, usage: "Usage: tst status", run: () => 0 },
      },
    }),
  );

  // When --version is the first argv token
  const { result, captured } = await captureConsole(() =>
    cli.run(["--version"]),
  );

  // Then the version string is emitted alone on stdout
  assertEquals(result, 0);
  assertEquals(captured.stdout.trim(), "1.2.3");
});

Deno.test("defineCli routes a known subcommand to its runner with parsed flags", async () => {
  // Given a CLI with a command that captures its received context
  let receivedFlags: Record<string, unknown> | null = null;
  const cli = defineCli(
    buildConfig({
      commands: {
        add: {
          flags: { yes: { kind: "boolean" } },
          usage: "Usage: tst add [--yes]",
          run: ({ flags }) => {
            receivedFlags = flags as Record<string, unknown>;
            return 0;
          },
        },
      },
    }),
  );

  // When the subcommand is dispatched with a known flag
  const { result } = await captureConsole(() => cli.run(["add", "--yes"]));

  // Then the runner saw the parsed flag and the CLI returns the
  // runner's exit code
  assertEquals(result, 0);
  assertEquals(receivedFlags, { yes: true });
});

Deno.test("defineCli prints per-command usage on `<cmd> --help`", async () => {
  // Given a CLI with a command whose usage line is distinctive
  const cli = defineCli(
    buildConfig({
      commands: {
        status: {
          flags: { json: { kind: "boolean" } },
          usage: "Usage: tst status [--json]",
          run: () => 0,
        },
      },
    }),
  );

  // When --help follows the subcommand name
  const { result, captured } = await captureConsole(() =>
    cli.run(["status", "--help"]),
  );

  // Then the command-specific usage is what gets printed (not the
  // top-level usage)
  assertEquals(result, 0);
  assertStringIncludes(captured.stdout, "Usage: tst status [--json]");
  assertEquals(captured.stdout.includes("Usage: tst <command>"), false);
});

Deno.test("defineCli reports unknown subcommands on stderr and exits 2", async () => {
  // Given a CLI with one declared command
  const cli = defineCli(
    buildConfig({
      commands: {
        add: { flags: {}, usage: "Usage: tst add", run: () => 0 },
      },
    }),
  );

  // When an undeclared subcommand is dispatched
  const { result, captured } = await captureConsole(() =>
    cli.run(["bogus"]),
  );

  // Then stderr names the unknown command and exit code is 2
  assertEquals(result, 2);
  assertStringIncludes(captured.stderr, "unknown command 'bogus'");
  assertStringIncludes(captured.stderr, "run 'tst --help' for usage");
});

Deno.test("defineCli reports unknown flags for a subcommand on stderr and exits 2", async () => {
  // Given a command with only --yes declared
  const cli = defineCli(
    buildConfig({
      commands: {
        add: {
          flags: { yes: { kind: "boolean" } },
          usage: "Usage: tst add [--yes]",
          run: () => 0,
        },
      },
    }),
  );

  // When an unknown flag is passed
  const { result, captured } = await captureConsole(() =>
    cli.run(["add", "--whatever"]),
  );

  // Then stderr quotes the offending flag and exit code is 2
  assertEquals(result, 2);
  assertStringIncludes(captured.stderr, "unknown flag '--whatever'");
  assertStringIncludes(captured.stderr, "run 'tst add --help' for usage");
});

Deno.test("defineCli passes through a runner's non-zero exit code", async () => {
  // Given a command whose runner returns 3
  const cli = defineCli(
    buildConfig({
      commands: {
        status: { flags: {}, usage: "Usage: tst status", run: () => 3 },
      },
    }),
  );

  // When dispatched
  const { result } = await captureConsole(() => cli.run(["status"]));

  // Then the framework returns the runner's exit code verbatim
  assertEquals(result, 3);
});

Deno.test("defineCli calls reportError and exits 1 when a runner throws", async () => {
  // Given a runner that throws and a CLI configured with reportError
  const reportedErrors: unknown[] = [];
  const cli = defineCli(
    buildConfig({
      commands: {
        status: {
          flags: {},
          usage: "Usage: tst status",
          run: () => {
            throw new Error("boom");
          },
        },
      },
      reportError: (caughtError) => {
        reportedErrors.push(caughtError);
      },
    }),
  );

  // When dispatched
  const { result } = await captureConsole(() => cli.run(["status"]));

  // Then reportError received the thrown error and exit code is 1
  assertEquals(result, 1);
  assertEquals(reportedErrors.length, 1);
  assertEquals((reportedErrors[0] as Error).message, "boom");
});

Deno.test("defineCli exits 1 silently when a runner throws and no reportError is set", async () => {
  // Given a runner that throws and a CLI with no reportError hook
  const cli = defineCli(
    buildConfig({
      commands: {
        status: {
          flags: {},
          usage: "Usage: tst status",
          run: () => {
            throw new Error("silent boom");
          },
        },
      },
    }),
  );

  // When dispatched
  const { result, captured } = await captureConsole(() =>
    cli.run(["status"]),
  );

  // Then nothing reaches stderr (the framework never writes on a
  // thrown error itself; that is reportError's job) and exit code is 1
  assertEquals(result, 1);
  assertEquals(captured.stderr, "");
});
