import { DvError } from "../../domain/errors.ts";

// Backstop for the finalize op (specs/plugin-contract.md § finalize).
// A plugin's finalize Op refreshes generated companion files (deno.lock,
// package-lock.json, Cargo.lock, …) and reports their paths in
// `additionalChangedFiles`; dv stages exactly those. But dv can only
// stage what the plugin reports — a plugin that refreshes a file and
// forgets to report it leaves the working tree dirty *after* staging,
// and the version commit silently ships incomplete (the original
// deno.lock bug: ROADMAP § Post-first-release follow-ups).
//
// This guard closes that gap: after staging, any tracked file that is
// still modified-but-unstaged is a companion file the plugin failed to
// report. We use `git diff --name-only` (working tree vs index) so it
// catches modified-but-unstaged tracked files and never false-positives
// on unrelated untracked files.
//
// Severity is keyed to clean-tree posture (the `requireCleanTree`
// resolution in version.ts / v1.ts), since `--allow-dirty` changes what
// "dirty" means:
//   - requireCleanTree true  → hard error. The tree was asserted clean
//     at the start, so post-stage drift can only be an unreported
//     companion file. Fail-closed, like assertCleanTree.
//   - requireCleanTree false → warning only. The user opted into a dirty
//     tree (`--allow-dirty`), so we can't distinguish their intentional
//     dirt from a missed companion file; warn rather than block.

export interface AssertNoUnstagedFinalizeDriftArgs {
  repoRootPath: string;
  // The resolved clean-tree posture for this run (flag over config).
  // Drives error-vs-warning; see module comment.
  requireCleanTree: boolean;
  // Sink for the warning path so callers control rendering (stderr,
  // styled, etc.). Only invoked when requireCleanTree is false.
  warn: (unstagedPaths: string[]) => void;
}

export async function assertNoUnstagedFinalizeDrift(
  args: AssertNoUnstagedFinalizeDriftArgs,
): Promise<void> {
  const diffResult = await new Deno.Command("git", {
    args: ["-C", args.repoRootPath, "diff", "--name-only"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!diffResult.success) {
    const stderrText = new TextDecoder().decode(diffResult.stderr).trim();
    throw new DvError({
      code: "git-status-failed",
      message: `failed to check for unstaged finalize drift: ${
        stderrText || `exit ${diffResult.code}`
      }`,
    });
  }
  const unstagedPaths = new TextDecoder()
    .decode(diffResult.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (unstagedPaths.length === 0) return;

  if (!args.requireCleanTree) {
    args.warn(unstagedPaths);
    return;
  }
  throw new DvError({
    code: "unstaged-finalize-drift",
    context: { unstagedPaths },
    message: `working tree still has unstaged changes after the finalize pass: ${unstagedPaths.join(
      ", ",
    )}`,
    hint:
      "a finalize plugin likely refreshed these files but did not report them " +
      "in additionalChangedFiles — fix the plugin's finalize op, or pass " +
      "--allow-dirty to downgrade this to a warning",
  });
}
