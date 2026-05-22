import { DvError } from "../../domain/errors.ts";

// Read-side git tag queries used by `dv status` and `dv release` to
// decide which Packages are awaiting release (specs/language.md
// Algebra §4: a Package is released iff its current Version has a
// matching Tag — stateless, no separate release-state file).
//
// Both queries are deliberately non-throwing on the "no such tag"
// path: tagExists returns false, listTagsMatching returns []. Only
// failures of git itself (missing binary, repository issues) throw.

export interface TagExistsArgs {
  repoRootPath: string;
  tag: string;
}

export async function tagExists(args: TagExistsArgs): Promise<boolean> {
  const verifyResult = await new Deno.Command("git", {
    args: [
      "-C",
      args.repoRootPath,
      "rev-parse",
      "--verify",
      `refs/tags/${args.tag}`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  // Exit 128 (or any non-zero) is the "tag doesn't exist" answer —
  // a normal result, not a failure of the operation itself.
  return verifyResult.success;
}

export interface ListTagsMatchingArgs {
  repoRootPath: string;
  // Glob in `git tag --list <pattern>` form. Defaults to `*` (all).
  pattern?: string;
}

export async function listTagsMatching(
  args: ListTagsMatchingArgs,
): Promise<string[]> {
  const listResult = await new Deno.Command("git", {
    args: [
      "-C",
      args.repoRootPath,
      "tag",
      "--list",
      ...(args.pattern !== undefined ? [args.pattern] : []),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!listResult.success) {
    const stderrText = new TextDecoder().decode(listResult.stderr).trim();
    throw new DvError({
      code: "git-tag-list-failed",
      message: `failed to list tags: ${stderrText || `exit ${listResult.code}`}`,
    });
  }
  const stdoutText = new TextDecoder().decode(listResult.stdout);
  return stdoutText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
