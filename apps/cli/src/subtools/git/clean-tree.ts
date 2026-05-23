import { DvError } from "../../domain/errors.ts";

// Verifies the working tree is clean before `dv version` runs (specs/
// config-format.md § git.require-clean-tree). The check uses
// `git status --porcelain=v1`: any non-empty output indicates modified,
// staged, or untracked files. Files inside `.dv/records/` count —
// they're how the user got here; the user committing first is the
// expected workflow.
//
// Fail-closed by design: silently ignoring stray edits would risk
// bundling unrelated changes into the version commit.

export interface AssertCleanTreeArgs {
  repoRootPath: string;
}

export async function assertCleanTree(
  args: AssertCleanTreeArgs,
): Promise<void> {
  const statusResult = await new Deno.Command("git", {
    args: ["-C", args.repoRootPath, "status", "--porcelain=v1"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!statusResult.success) {
    const stderrText = new TextDecoder().decode(statusResult.stderr).trim();
    throw new DvError({
      code: "git-status-failed",
      message: `failed to read working tree status: ${stderrText || `exit ${statusResult.code}`}`,
    });
  }
  const porcelainOutput = new TextDecoder().decode(statusResult.stdout);
  if (porcelainOutput.trim().length > 0) {
    throw new DvError({
      code: "dirty-tree",
      message:
        "working tree is not clean — commit or stash changes before running `dv version`",
      hint: "commit or stash your changes, or run with --allow-dirty if your config permits",
    });
  }
}
