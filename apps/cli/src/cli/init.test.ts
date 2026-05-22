import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runInit } from "./init.ts";

// `dv init` walks up to the git root; tests need a temp git repo for that
// lookup to succeed. The host's `git` CLI must be available — same as in
// production.

interface InTempRepoArgs {
  testBody: () => Promise<void>;
}

async function inTempRepo(args: InTempRepoArgs): Promise<void> {
  const temporaryRepoDirectory = await Deno.makeTempDir({ prefix: "dv-init-" });
  const previousWorkingDirectory = Deno.cwd();
  try {
    Deno.chdir(temporaryRepoDirectory);
    const gitInitResult = await new Deno.Command("git", {
      args: ["init", "-q"],
    }).output();
    if (!gitInitResult.success) {
      throw new Error("git init failed");
    }
    await args.testBody();
  } finally {
    Deno.chdir(previousWorkingDirectory);
    await Deno.remove(temporaryRepoDirectory, { recursive: true });
  }
}

Deno.test("runInit creates the config file and records directory in a fresh repo", async () => {
  await inTempRepo({
    testBody: async () => {
      // Given a fresh git repo with no .changelog/ directory

      // When runInit is called
      const initResult = await runInit();

      // Then both the config file and records directory exist on disk
      assertEquals(initResult.configCreated, true);
      assertEquals(initResult.recordsDirCreated, true);
      const configFileStat = await Deno.stat(
        join(initResult.repoRoot, ".changelog", "config.yaml"),
      );
      assertEquals(configFileStat.isFile, true);
      const recordsDirStat = await Deno.stat(
        join(initResult.repoRoot, ".changelog", "records"),
      );
      assertEquals(recordsDirStat.isDirectory, true);
    },
  });
});

Deno.test("runInit is idempotent and reports nothing-created on a second invocation", async () => {
  await inTempRepo({
    testBody: async () => {
      // Given a repo that has already been initialized once
      await runInit();

      // When runInit is called again
      const secondInitResult = await runInit();

      // Then no files were created on the second call
      assertEquals(secondInitResult.configCreated, false);
      assertEquals(secondInitResult.recordsDirCreated, false);
    },
  });
});

Deno.test("runInit leaves an existing user-authored config untouched", async () => {
  await inTempRepo({
    testBody: async () => {
      // Given a repo where the user has already authored their own config
      await Deno.mkdir(".changelog", { recursive: true });
      await Deno.writeTextFile(".changelog/config.yaml", "# hand-written\n");

      // When runInit is called
      const initResult = await runInit();

      // Then the existing config is preserved verbatim
      assertEquals(initResult.configCreated, false);
      const preservedConfigBody = await Deno.readTextFile(
        join(initResult.repoRoot, ".changelog", "config.yaml"),
      );
      assertEquals(preservedConfigBody, "# hand-written\n");
    },
  });
});
