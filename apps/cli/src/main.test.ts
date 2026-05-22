import { assertEquals, assertStringIncludes } from "@std/assert";
import { main } from "./main.ts";

// End-to-end tests for the binary's error-reporting boundary. They
// exercise the reporter closure built in `main()` — argv pre-scan,
// renderCliError delegation, human vs JSON output — by invoking
// `main()` with argv known to fail and capturing stderr.
//
// `dv status` in a non-git directory is the simplest reliable
// failure path: requireRepoRoot throws DvError('not-a-git-repo')
// before any plugin is touched.

interface CapturedConsole {
  stdout: string;
  stderr: string;
}

async function captureConsole<T>(
  action: () => Promise<T>,
): Promise<{ result: T; captured: CapturedConsole }> {
  const originalLog = console.log;
  const originalError = console.error;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  console.log = (...parts: unknown[]) => {
    stdoutLines.push(parts.map((part) => String(part)).join(" "));
  };
  console.error = (...parts: unknown[]) => {
    stderrLines.push(parts.map((part) => String(part)).join(" "));
  };
  try {
    const result = await action();
    return {
      result,
      captured: {
        stdout: stdoutLines.join("\n"),
        stderr: stderrLines.join("\n"),
      },
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

interface WithNonGitCwdArgs {
  testBody: () => Promise<void>;
}

async function withNonGitCwd(args: WithNonGitCwdArgs): Promise<void> {
  // Use a fresh temp dir with no `.git` so `requireRepoRoot` throws
  // the `not-a-git-repo` DvError. cd in, run, cd back — keeps the
  // test isolated even when run in parallel.
  const originalCwd = Deno.cwd();
  const temporaryNonGitDir = await Deno.makeTempDir({
    prefix: "dv-main-test-",
  });
  Deno.chdir(temporaryNonGitDir);
  try {
    await args.testBody();
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(temporaryNonGitDir, { recursive: true });
  }
}

Deno.test("main() renders a human error envelope on stderr when no --json flag is passed", async () => {
  await withNonGitCwd({
    testBody: async () => {
      // Given `dv status` in a non-git directory (which throws
      // DvError('not-a-git-repo'))
      // When main runs without --json
      const { result, captured } = await captureConsole(() => main(["status"]));

      // Then exit is 1 and stderr carries the human-formatted error
      // line prefixed with `dv ` (the consumer adds the binary name;
      // renderCliError supplies the rest)
      assertEquals(result, 1);
      assertStringIncludes(captured.stderr, "dv error[not-a-git-repo]:");
      assertStringIncludes(captured.stderr, "not inside a git repository");
      // The opportunistic hint added in EC3 rides along
      assertStringIncludes(captured.stderr, "hint:");
      assertStringIncludes(captured.stderr, "git init");
    },
  });
});

Deno.test("main() emits the cli-error JSON envelope on stderr when --json is passed", async () => {
  await withNonGitCwd({
    testBody: async () => {
      // Given `dv status --json` in a non-git directory
      // When main runs
      const { result, captured } = await captureConsole(() =>
        main(["status", "--json"]),
      );

      // Then exit is 1 and stderr carries a parseable cli-error
      // envelope matching the v1 schema URN
      assertEquals(result, 1);
      const parsedEnvelope = JSON.parse(captured.stderr) as {
        schema: string;
        error: { code: string; message: string; hint?: string };
      };
      assertEquals(parsedEnvelope.schema, "urn:dv:schema:v1:cli-error");
      assertEquals(parsedEnvelope.error.code, "not-a-git-repo");
      assertStringIncludes(
        parsedEnvelope.error.message,
        "not inside a git repository",
      );
      // The hint rides along in JSON mode too — it's a contract field
      assertStringIncludes(parsedEnvelope.error.hint ?? "", "git init");
    },
  });
});

Deno.test("main() in --json mode suppresses ANSI color escapes regardless of the color flag", async () => {
  await withNonGitCwd({
    testBody: async () => {
      // Given `dv status --json --color` (the explicit --color
      // attempting to turn on colors)
      // When main runs
      const { captured } = await captureConsole(() =>
        main(["status", "--json", "--color"]),
      );

      // Then no ANSI escape leaks into the JSON envelope — color is
      // a human-mode concern only, and JSON consumers must not have
      // to strip escapes before parsing
      assertEquals(captured.stderr.includes("\x1b["), false);
    },
  });
});
