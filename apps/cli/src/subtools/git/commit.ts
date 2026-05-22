import type { GitSign } from "../../domain/config.ts";
import { DvError } from "../../domain/errors.ts";

// Creates a commit from currently-staged changes. `dv version` produces
// exactly one such commit (the Release PR) per specs/cli.md § dv version.
//
// Signing follows the git.sign config option (specs/config-format.md §
// git.sign): `"auto"` honors git's own commit.gpgsign config (no flag
// passed); `true` forces `-S`; `false` disables with `--no-gpg-sign`.
// Tag signing is M5's problem.

export interface CommitChangesArgs {
  repoRootPath: string;
  message: string;
  sign: GitSign;
}

export interface CommitChangesResult {
  commitSha: string;
}

export async function commitChanges(
  args: CommitChangesArgs,
): Promise<CommitChangesResult> {
  const commitArgv = ["-C", args.repoRootPath, "commit", "-m", args.message];
  if (args.sign === true) commitArgv.push("-S");
  else if (args.sign === false) commitArgv.push("--no-gpg-sign");
  // sign === "auto" → pass no flag; git's own config decides.

  const commitResult = await new Deno.Command("git", {
    args: commitArgv,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!commitResult.success) {
    const stderrText = new TextDecoder().decode(commitResult.stderr).trim();
    throw new DvError({
      code: "git-commit-failed",
      message: `failed to commit: ${stderrText || `exit ${commitResult.code}`}`,
    });
  }

  const revParseResult = await new Deno.Command("git", {
    args: ["-C", args.repoRootPath, "rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!revParseResult.success) {
    throw new DvError({
      code: "git-rev-parse-failed",
      message: "commit succeeded but rev-parse HEAD failed",
    });
  }
  const commitSha = new TextDecoder().decode(revParseResult.stdout).trim();
  return { commitSha };
}
