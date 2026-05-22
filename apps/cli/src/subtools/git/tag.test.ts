import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { mintTag } from "./tag.ts";

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoWithCommit(): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-tag-" });
  const gitInitResult = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");
  // Local identity so commits and tags don't depend on the host's
  // global git config.
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
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "tag.gpgsign", "false"],
  }).output();

  // git tag refuses to tag an empty history, so seed with one commit.
  await Deno.writeTextFile(join(repoRootPath, "seed.txt"), "x");
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "add", "seed.txt"],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "commit", "-m", "seed", "--no-gpg-sign", "-q"],
  }).output();
  return {
    repoRootPath,
    cleanup: async () => {
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

async function readTagMessage(
  repoRootPath: string,
  tag: string,
): Promise<string> {
  const showOutput = await new Deno.Command("git", {
    args: [
      "-C",
      repoRootPath,
      "for-each-ref",
      "--format=%(contents:subject)",
      `refs/tags/${tag}`,
    ],
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(showOutput.stdout).trim();
}

Deno.test("mintTag creates an annotated tag with the supplied message", async () => {
  // Given a repo with one commit and no tags
  const fixture = await setUpRepoWithCommit();

  // When mintTag runs with sign:false
  try {
    await mintTag({
      repoRootPath: fixture.repoRootPath,
      tag: "core@1.0.0",
      message: "Release core@1.0.0",
      sign: false,
    });

    // Then the tag exists and carries the annotation message
    const subject = await readTagMessage(fixture.repoRootPath, "core@1.0.0");
    assertEquals(subject, "Release core@1.0.0");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("mintTag throws DvError('git-tag-failed') when a tag with the same name already exists", async () => {
  // Given a repo where the same tag was already minted
  const fixture = await setUpRepoWithCommit();
  await mintTag({
    repoRootPath: fixture.repoRootPath,
    tag: "core@1.0.0",
    message: "first",
    sign: false,
  });

  // When mintTag is called again with the same tag name
  // Then git refuses and DvError surfaces with the documented code —
  // dv release's caller-side `tagExists` check is what prevents this
  // collision in normal usage; the error is the safety net.
  try {
    const caughtError = await assertRejects(
      () =>
        mintTag({
          repoRootPath: fixture.repoRootPath,
          tag: "core@1.0.0",
          message: "second",
          sign: false,
        }),
      DvError,
    );
    assertEquals(caughtError.code, "git-tag-failed");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("mintTag with sign:'auto' passes no signing flag (honors git's own config)", async () => {
  // Given a repo with tag.gpgsign=false in its local config
  const fixture = await setUpRepoWithCommit();

  // When mintTag runs with sign:'auto'
  try {
    await mintTag({
      repoRootPath: fixture.repoRootPath,
      tag: "core@1.1.0",
      message: "auto-signed",
      sign: "auto",
    });

    // Then the tag lands (the local tag.gpgsign=false decided; we
    // didn't override it)
    const subject = await readTagMessage(fixture.repoRootPath, "core@1.1.0");
    assertEquals(subject, "auto-signed");
  } finally {
    await fixture.cleanup();
  }
});
