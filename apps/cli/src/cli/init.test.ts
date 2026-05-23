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

Deno.test("runInit creates the config file, records directory, and changelog gitignore in a fresh repo", async () => {
  await inTempRepo({
    testBody: async () => {
      // Given a fresh git repo with no .dv/ directory

      // When runInit is called
      const initResult = await runInit();

      // Then config, records directory, and .dv/.gitignore all
      // exist on disk
      assertEquals(initResult.configCreated, true);
      assertEquals(initResult.recordsDirCreated, true);
      assertEquals(initResult.gitignoreCreated, true);
      const configFileStat = await Deno.stat(
        join(initResult.repoRoot, ".dv", "config.yaml"),
      );
      assertEquals(configFileStat.isFile, true);
      const recordsDirStat = await Deno.stat(
        join(initResult.repoRoot, ".dv", "records"),
      );
      assertEquals(recordsDirStat.isDirectory, true);
      const gitignoreBody = await Deno.readTextFile(
        join(initResult.repoRoot, ".dv", ".gitignore"),
      );
      // The gitignore should at minimum cover the in-progress record
      // edit file pattern — that's the whole reason it exists
      assertEquals(gitignoreBody.includes(".dv-record-edit-*"), true);
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
      assertEquals(secondInitResult.gitignoreCreated, false);
    },
  });
});

Deno.test("runInit leaves a user-edited .dv/.gitignore untouched", async () => {
  await inTempRepo({
    testBody: async () => {
      // Given a repo where the user has already authored their own
      // changelog gitignore (e.g. they added more patterns over time)
      await Deno.mkdir(".dv", { recursive: true });
      const userAuthoredGitignore =
        "# my own patterns\n.dv-record-edit-*\n.custom-cache/\n";
      await Deno.writeTextFile(".dv/.gitignore", userAuthoredGitignore);

      // When runInit is called
      const initResult = await runInit();

      // Then the user's gitignore is preserved verbatim
      assertEquals(initResult.gitignoreCreated, false);
      const preservedBody = await Deno.readTextFile(
        join(initResult.repoRoot, ".dv", ".gitignore"),
      );
      assertEquals(preservedBody, userAuthoredGitignore);
    },
  });
});

Deno.test("runInit leaves an existing user-authored config untouched", async () => {
  await inTempRepo({
    testBody: async () => {
      // Given a repo where the user has already authored their own config
      await Deno.mkdir(".dv", { recursive: true });
      await Deno.writeTextFile(".dv/config.yaml", "# hand-written\n");

      // When runInit is called
      const initResult = await runInit();

      // Then the existing config is preserved verbatim
      assertEquals(initResult.configCreated, false);
      const preservedConfigBody = await Deno.readTextFile(
        join(initResult.repoRoot, ".dv", "config.yaml"),
      );
      assertEquals(preservedConfigBody, "# hand-written\n");
    },
  });
});
