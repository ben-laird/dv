import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { findRepoRootOrCwd } from "./repo-root.ts";

interface WithWorkingDirectoryArgs {
  workingDirectory: string;
  action: () => Promise<void>;
}

async function withWorkingDirectory(
  args: WithWorkingDirectoryArgs,
): Promise<void> {
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(args.workingDirectory);
  try {
    await args.action();
  } finally {
    Deno.chdir(previousWorkingDirectory);
  }
}

Deno.test("findRepoRootOrCwd returns the git repo root when run from a subdirectory of a repo", async () => {
  // Given a git repo and a cwd two levels below its root
  const repoRootPath = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "dv-repo-root-" }),
  );
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
  const subdirectoryPath = join(repoRootPath, "packages", "core");
  await Deno.mkdir(subdirectoryPath, { recursive: true });

  try {
    await withWorkingDirectory({
      workingDirectory: subdirectoryPath,
      action: async () => {
        // When the root is located
        const locatedPath = await findRepoRootOrCwd();

        // Then it is the repo root, not the cwd
        assertEquals(await Deno.realPath(locatedPath), repoRootPath);
      },
    });
  } finally {
    await Deno.remove(repoRootPath, { recursive: true });
  }
});

Deno.test("findRepoRootOrCwd falls back to the cwd outside a git repo", async () => {
  // Given a cwd that is not inside any git repo
  const outsidePath = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "dv-no-repo-" }),
  );

  try {
    await withWorkingDirectory({
      workingDirectory: outsidePath,
      action: async () => {
        // When the root is located
        const locatedPath = await findRepoRootOrCwd();

        // Then it is the cwd itself
        assertEquals(await Deno.realPath(locatedPath), outsidePath);
      },
    });
  } finally {
    await Deno.remove(outsidePath, { recursive: true });
  }
});
