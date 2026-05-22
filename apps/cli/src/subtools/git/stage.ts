import { DvError } from "../../domain/errors.ts";

// Stages a set of file paths via `git add`. Used by `dv version` to
// stage the manifest + CHANGELOG edits and record deletions into one
// commit. Paths are passed individually rather than via `-A` so we
// never accidentally pull in unrelated working-tree changes (the
// clean-tree check is the safety net, but explicit staging is the
// belt).

export interface StageFilesArgs {
  repoRootPath: string;
  paths: string[];
}

export async function stageFiles(args: StageFilesArgs): Promise<void> {
  if (args.paths.length === 0) return;
  const stageResult = await new Deno.Command("git", {
    args: ["-C", args.repoRootPath, "add", "--", ...args.paths],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!stageResult.success) {
    const stderrText = new TextDecoder().decode(stageResult.stderr).trim();
    throw new DvError({
      code: "git-stage-failed",
      message: `failed to stage files: ${stderrText || `exit ${stageResult.code}`}`,
    });
  }
}
