import { DvError } from "../../domain/errors.ts";

// Pushes a batch of tags to the `origin` remote in a single git
// push. Used by `dv release` when push is enabled (config.git
// .autoPush or `--push`). All tags go in one push so the remote
// either has the whole release batch or gets nothing — closer to
// atomic than per-tag pushes, and more efficient.
//
// No-op for an empty list — caller doesn't need to guard.

export interface PushTagsArgs {
  repoRootPath: string;
  tagNames: string[];
}

export async function pushTags(args: PushTagsArgs): Promise<void> {
  if (args.tagNames.length === 0) return;
  const pushResult = await new Deno.Command("git", {
    args: ["-C", args.repoRootPath, "push", "origin", ...args.tagNames],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!pushResult.success) {
    const stderrText = new TextDecoder().decode(pushResult.stderr).trim();
    throw new DvError({
      code: "git-push-failed",
      message: `failed to push tags (${args.tagNames.join(", ")}): ${stderrText || `exit ${pushResult.code}`}`,
      hint: "check that the `origin` remote exists and the tags don't already exist there",
      context: { tagNames: args.tagNames },
    });
  }
}
