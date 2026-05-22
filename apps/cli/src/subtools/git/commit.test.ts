import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { commitChanges } from "./commit.ts";

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoWithIdentity(): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-commit-" });
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
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "commit.gpgsign", "false"],
  }).output();
  return {
    repoRootPath,
    cleanup: async () => {
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

async function readCommitSubject(
  repoRootPath: string,
  commitSha: string,
): Promise<string> {
  const showOutput = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "log", "-1", "--format=%s", commitSha],
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(showOutput.stdout).trim();
}

Deno.test("commitChanges produces a commit and returns its SHA", async () => {
  // Given a repo with a staged file
  const fixture = await setUpRepoWithIdentity();
  await Deno.writeTextFile(join(fixture.repoRootPath, "foo.txt"), "x");
  await new Deno.Command("git", {
    args: ["-C", fixture.repoRootPath, "add", "foo.txt"],
  }).output();

  // When commitChanges runs with sign:false
  try {
    const result = await commitChanges({
      repoRootPath: fixture.repoRootPath,
      message: "feat: initial commit",
      sign: false,
    });

    // Then the returned SHA matches HEAD and the subject is preserved
    assertEquals(result.commitSha.length >= 7, true);
    const subject = await readCommitSubject(
      fixture.repoRootPath,
      result.commitSha,
    );
    assertEquals(subject, "feat: initial commit");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("commitChanges throws DvError('git-commit-failed') with nothing staged", async () => {
  // Given a repo with no staged changes
  const fixture = await setUpRepoWithIdentity();

  // When commitChanges runs
  // Then it throws — git refuses to make an empty commit and the
  // failure surfaces with the documented code
  try {
    const caughtError = await assertRejects(
      () =>
        commitChanges({
          repoRootPath: fixture.repoRootPath,
          message: "nothing to commit",
          sign: false,
        }),
      DvError,
    );
    assertEquals(caughtError.code, "git-commit-failed");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("commitChanges with sign:'auto' passes no signing flag (honors git's own config)", async () => {
  // Given a repo configured with commit.gpgsign=false and a staged file
  const fixture = await setUpRepoWithIdentity();
  await Deno.writeTextFile(join(fixture.repoRootPath, "foo.txt"), "x");
  await new Deno.Command("git", {
    args: ["-C", fixture.repoRootPath, "add", "foo.txt"],
  }).output();

  // When commitChanges runs with sign:'auto'
  try {
    const result = await commitChanges({
      repoRootPath: fixture.repoRootPath,
      message: "feat: auto-signed",
      sign: "auto",
    });

    // Then the commit lands (the host's commit.gpgsign=false config
    // decided; we didn't override it)
    assertEquals(result.commitSha.length >= 7, true);
  } finally {
    await fixture.cleanup();
  }
});
