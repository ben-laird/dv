import { assertEquals } from "@std/assert";
import { join } from "@std/path";
// Import through the package's public library entry (deno.json `exports`),
// not the internal `./cli/status.ts` — the point of this test is to prove
// that wiring, so a regression that drops the re-export fails here.
import { type Plan, runStatus } from "./lib.ts";

// Wiring test for the public library surface (`./lib.ts`). The full
// status pipeline is already covered by status.test.ts; here we only
// assert that a runner re-exported from the library entry is callable
// in-process and returns the typed Plan contract. The fixture mirrors
// the temp-git-repo + fake-plugin pattern shared across the cli tests.

interface SetUpRepoResult {
  cleanup: () => Promise<void>;
}

async function setUpRepoWithPlugin(): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-lib-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);
  const gitInitResult = await new Deno.Command("git", {
    args: ["init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");

  const configDir = join(repoRootPath, ".dv");
  await Deno.mkdir(join(configDir, "records"), { recursive: true });
  await Deno.writeTextFile(
    join(configDir, "config.yaml"),
    `discovery:
  plugins:
    - match: "packages/*"
      use:
        path: ./plugin
`,
  );

  const pluginPath = join(repoRootPath, "plugin");
  await Deno.writeTextFile(
    pluginPath,
    `#!/usr/bin/env bash
set -euo pipefail
case "\${DV_OPERATION:-$1}" in
  discover)
    echo '{"packages":[{"name":"core","path":"packages/core"}]}'
    ;;
  read-version)
    echo '{"version":"1.4.2"}'
    ;;
esac
`,
  );
  await Deno.chmod(pluginPath, 0o755);

  return {
    cleanup: async () => {
      Deno.chdir(previousWorkingDirectory);
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

async function withSuppressedStdout<T>(action: () => Promise<T>): Promise<T> {
  const originalConsoleLog = console.log;
  console.log = () => {};
  try {
    return await action();
  } finally {
    console.log = originalConsoleLog;
  }
}

Deno.test("runStatus re-exported from the library entry returns a typed Plan", async () => {
  // Given a repo with one discovered package at version 1.4.2
  const fixture = await setUpRepoWithPlugin();

  try {
    // When the library-entry runStatus runs in-process
    const result = await withSuppressedStdout(() =>
      runStatus({ emitJson: false, colorEnabled: false }),
    );

    // Then it resolves to the typed Plan contract carrying the tracked package
    const plan: Plan | null = result.plan;
    assertEquals(plan?.tracked, [
      { package: "core", currentVersion: "1.4.2", path: "packages/core" },
    ]);
  } finally {
    await fixture.cleanup();
  }
});
