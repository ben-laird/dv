import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { assertNoUnstagedFinalizeDrift } from "./finalize-drift.ts";

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoWithCommittedFile(): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-finalize-drift-" });
  const run = (args: string[]) =>
    new Deno.Command("git", { args: ["-C", repoRootPath, ...args] }).output();
  await run(["init", "-q"]);
  await run(["config", "user.email", "dv-test@example.invalid"]);
  await run(["config", "user.name", "dv test"]);
  // One committed companion file to stand in for a lockfile.
  await Deno.writeTextFile(join(repoRootPath, "deno.lock"), "v1\n");
  await run(["add", "deno.lock"]);
  await run(["commit", "-m", "initial", "--no-gpg-sign"]);
  return {
    repoRootPath,
    cleanup: () => Deno.remove(repoRootPath, { recursive: true }),
  };
}

Deno.test("assertNoUnstagedFinalizeDrift returns silently when the tree is fully staged", async () => {
  // Given a repo whose only change has been staged (the plugin reported it)
  const fixture = await setUpRepoWithCommittedFile();
  await Deno.writeTextFile(join(fixture.repoRootPath, "deno.lock"), "v2\n");
  await new Deno.Command("git", {
    args: ["-C", fixture.repoRootPath, "add", "deno.lock"],
  }).output();

  // When the post-stage guard runs
  // Then it returns without throwing — nothing is left unstaged
  try {
    let warned = false;
    await assertNoUnstagedFinalizeDrift({
      repoRootPath: fixture.repoRootPath,
      requireCleanTree: true,
      warn: () => {
        warned = true;
      },
    });
    assertEquals(warned, false);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("assertNoUnstagedFinalizeDrift throws DvError('unstaged-finalize-drift') when a tracked file is modified-but-unstaged and a clean tree is required", async () => {
  // Given a companion file the plugin refreshed but did NOT report,
  // so it is modified in the working tree but never staged
  const fixture = await setUpRepoWithCommittedFile();
  await Deno.writeTextFile(
    join(fixture.repoRootPath, "deno.lock"),
    "drifted\n",
  );

  // When the guard runs with clean-tree required (no --allow-dirty)
  // Then it throws, carrying the code and the offending path
  try {
    const caughtError = await assertRejects(
      () =>
        assertNoUnstagedFinalizeDrift({
          repoRootPath: fixture.repoRootPath,
          requireCleanTree: true,
          warn: () => {},
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "unstaged-finalize-drift");
    if (caughtError.kind.code === "unstaged-finalize-drift") {
      assertEquals(caughtError.kind.context.unstagedPaths, ["deno.lock"]);
    }
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("assertNoUnstagedFinalizeDrift warns instead of throwing under --allow-dirty", async () => {
  // Given the same unreported drift, but the run opted into a dirty tree
  const fixture = await setUpRepoWithCommittedFile();
  await Deno.writeTextFile(
    join(fixture.repoRootPath, "deno.lock"),
    "drifted\n",
  );

  // When the guard runs with requireCleanTree false (--allow-dirty)
  // Then it does not throw; it routes the paths to the warn sink
  try {
    let warnedPaths: string[] = [];
    await assertNoUnstagedFinalizeDrift({
      repoRootPath: fixture.repoRootPath,
      requireCleanTree: false,
      warn: (paths) => {
        warnedPaths = paths;
      },
    });
    assertEquals(warnedPaths, ["deno.lock"]);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("assertNoUnstagedFinalizeDrift ignores untracked files (only flags tracked-but-unstaged drift)", async () => {
  // Given an untracked stray file — not a companion the plugin refreshed,
  // just unrelated content the user may have left around under --allow-dirty
  const fixture = await setUpRepoWithCommittedFile();
  await Deno.writeTextFile(join(fixture.repoRootPath, "scratch.txt"), "hi\n");

  // When the guard runs requiring a clean tree
  // Then it does not fire — `git diff --name-only` only sees tracked drift,
  // so unrelated untracked files never masquerade as missed companions
  try {
    let warned = false;
    await assertNoUnstagedFinalizeDrift({
      repoRootPath: fixture.repoRootPath,
      requireCleanTree: true,
      warn: () => {
        warned = true;
      },
    });
    assertEquals(warned, false);
  } finally {
    await fixture.cleanup();
  }
});
