import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { stageFiles } from "./stage.ts";

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpEmptyGitRepo(): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-stage-" });
  const gitInitResult = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");
  return {
    repoRootPath,
    cleanup: async () => {
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

async function readGitStatus(repoRootPath: string): Promise<string> {
  const statusOutput = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "status", "--porcelain=v1"],
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(statusOutput.stdout);
}

Deno.test("stageFiles is a no-op for an empty path list", async () => {
  // Given a repo with no work to stage
  const fixture = await setUpEmptyGitRepo();

  // When stageFiles is called with no paths
  // Then it returns silently and git status remains clean
  try {
    await stageFiles({ repoRootPath: fixture.repoRootPath, paths: [] });
    assertEquals((await readGitStatus(fixture.repoRootPath)).trim(), "");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("stageFiles adds the named files to the index", async () => {
  // Given a repo with two new files on disk
  const fixture = await setUpEmptyGitRepo();
  await Deno.writeTextFile(join(fixture.repoRootPath, "foo.txt"), "a");
  await Deno.writeTextFile(join(fixture.repoRootPath, "bar.txt"), "b");

  // When stageFiles stages both
  await stageFiles({
    repoRootPath: fixture.repoRootPath,
    paths: ["foo.txt", "bar.txt"],
  });

  // Then both appear as new/staged in the porcelain output
  try {
    const statusText = await readGitStatus(fixture.repoRootPath);
    assertEquals(statusText.includes("A  foo.txt"), true);
    assertEquals(statusText.includes("A  bar.txt"), true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("stageFiles can stage a deletion of a tracked file", async () => {
  // Given a repo with a committed file that's been deleted from disk
  const fixture = await setUpEmptyGitRepo();
  const filePath = join(fixture.repoRootPath, "doomed.txt");
  await Deno.writeTextFile(filePath, "x");
  await new Deno.Command("git", {
    args: ["-C", fixture.repoRootPath, "add", "doomed.txt"],
  }).output();
  await new Deno.Command("git", {
    args: [
      "-C",
      fixture.repoRootPath,
      "-c",
      "user.email=dv-test@example.invalid",
      "-c",
      "user.name=dv test",
      "commit",
      "-m",
      "initial",
      "--no-gpg-sign",
    ],
  }).output();
  await Deno.remove(filePath);

  // When stageFiles is called with the deleted path
  await stageFiles({
    repoRootPath: fixture.repoRootPath,
    paths: ["doomed.txt"],
  });

  // Then the deletion is staged
  try {
    const statusText = await readGitStatus(fixture.repoRootPath);
    assertEquals(statusText.includes("D  doomed.txt"), true);
  } finally {
    await fixture.cleanup();
  }
});
