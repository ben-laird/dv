import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { assertCleanTree } from "./clean-tree.ts";

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpEmptyGitRepo(): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-clean-tree-" });
  const gitInitResult = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");
  // Local identity so commits don't depend on the host's global git config.
  await new Deno.Command("git", {
    args: [
      "-C",
      repoRootPath,
      "config",
      "user.email",
      "dv-test@example.invalid",
    ],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "user.name", "dv test"],
  }).output();
  return {
    repoRootPath,
    cleanup: async () => {
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

Deno.test("assertCleanTree returns silently for an empty initialized repo", async () => {
  // Given a fresh `git init`d repo with nothing in it
  const fixture = await setUpEmptyGitRepo();

  // When the clean-tree check runs
  // Then it returns without throwing
  try {
    await assertCleanTree({ repoRootPath: fixture.repoRootPath });
    assertEquals(true, true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("assertCleanTree throws DvError('dirty-tree') when an untracked file exists", async () => {
  // Given a repo with an untracked file
  const fixture = await setUpEmptyGitRepo();
  await Deno.writeTextFile(join(fixture.repoRootPath, "stray.txt"), "junk");

  // When the clean-tree check runs
  // Then it throws DvError carrying the documented code
  try {
    const caughtError = await assertRejects(
      () => assertCleanTree({ repoRootPath: fixture.repoRootPath }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "dirty-tree");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("assertCleanTree throws DvError('dirty-tree') when a tracked file is modified", async () => {
  // Given a repo with one committed file that has been edited
  const fixture = await setUpEmptyGitRepo();
  const filePath = join(fixture.repoRootPath, "tracked.txt");
  await Deno.writeTextFile(filePath, "initial");
  await new Deno.Command("git", {
    args: ["-C", fixture.repoRootPath, "add", "tracked.txt"],
  }).output();
  await new Deno.Command("git", {
    args: [
      "-C",
      fixture.repoRootPath,
      "commit",
      "-m",
      "initial",
      "--no-gpg-sign",
    ],
  }).output();
  await Deno.writeTextFile(filePath, "modified");

  // When the clean-tree check runs
  // Then it throws — modified-but-uncommitted state is dirty
  try {
    const caughtError = await assertRejects(
      () => assertCleanTree({ repoRootPath: fixture.repoRootPath }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "dirty-tree");
  } finally {
    await fixture.cleanup();
  }
});
