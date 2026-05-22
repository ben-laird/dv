import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { pushTags } from "./push.ts";

interface SetUpPusherFixtureResult {
  workingRepoPath: string;
  bareRemotePath: string;
  cleanup: () => Promise<void>;
}

async function setUpPusherFixture(): Promise<SetUpPusherFixtureResult> {
  const baseDir = await Deno.makeTempDir({ prefix: "dv-push-" });
  const workingRepoPath = join(baseDir, "working");
  const bareRemotePath = join(baseDir, "remote.git");
  await Deno.mkdir(workingRepoPath, { recursive: true });
  await new Deno.Command("git", {
    args: ["init", "-q", "--bare", bareRemotePath],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", workingRepoPath, "init", "-q"],
  }).output();
  await new Deno.Command("git", {
    args: [
      "-C",
      workingRepoPath,
      "config",
      "user.email",
      "dv-test@example.invalid",
    ],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", workingRepoPath, "config", "user.name", "dv test"],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", workingRepoPath, "config", "commit.gpgsign", "false"],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", workingRepoPath, "remote", "add", "origin", bareRemotePath],
  }).output();
  await Deno.writeTextFile(join(workingRepoPath, "seed.txt"), "x");
  await new Deno.Command("git", {
    args: ["-C", workingRepoPath, "add", "seed.txt"],
  }).output();
  await new Deno.Command("git", {
    args: [
      "-C",
      workingRepoPath,
      "commit",
      "-m",
      "seed",
      "--no-gpg-sign",
      "-q",
    ],
  }).output();
  // Mint a couple of local tags so the push has something to send.
  await new Deno.Command("git", {
    args: ["-C", workingRepoPath, "tag", "-a", "core@1.0.0", "-m", "first"],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", workingRepoPath, "tag", "-a", "cli@0.1.0", "-m", "first"],
  }).output();
  return {
    workingRepoPath,
    bareRemotePath,
    cleanup: async () => {
      await Deno.remove(baseDir, { recursive: true });
    },
  };
}

async function readRemoteTags(bareRemotePath: string): Promise<string[]> {
  const listOutput = await new Deno.Command("git", {
    args: ["-C", bareRemotePath, "tag", "--list"],
    stdout: "piped",
  }).output();
  return new TextDecoder()
    .decode(listOutput.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

Deno.test("pushTags is a no-op for an empty tag list", async () => {
  // Given a repo + remote with tags only locally
  const fixture = await setUpPusherFixture();

  // When pushTags is called with no tags
  try {
    await pushTags({
      repoRootPath: fixture.workingRepoPath,
      tagNames: [],
    });

    // Then the remote remains empty (nothing was pushed)
    const remoteTags = await readRemoteTags(fixture.bareRemotePath);
    assertEquals(remoteTags, []);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("pushTags sends the supplied tags to origin in a single batch", async () => {
  // Given a repo + bare remote with two local tags
  const fixture = await setUpPusherFixture();

  // When pushTags pushes both
  try {
    await pushTags({
      repoRootPath: fixture.workingRepoPath,
      tagNames: ["core@1.0.0", "cli@0.1.0"],
    });

    // Then both appear on the remote (one batch push, not two)
    const remoteTags = await readRemoteTags(fixture.bareRemotePath);
    assertEquals(remoteTags.includes("core@1.0.0"), true);
    assertEquals(remoteTags.includes("cli@0.1.0"), true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("pushTags throws DvError('git-push-failed') when a referenced tag does not exist", async () => {
  // Given a repo + remote with no local tag matching the requested name
  const fixture = await setUpPusherFixture();

  // When pushTags is asked to push a phantom tag
  // Then DvError surfaces with the documented code — the failure is
  // contained (tags stay local; remote unchanged)
  try {
    const caughtError = await assertRejects(
      () =>
        pushTags({
          repoRootPath: fixture.workingRepoPath,
          tagNames: ["does-not-exist@9.9.9"],
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "git-push-failed");
  } finally {
    await fixture.cleanup();
  }
});
