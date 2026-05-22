import { DvError } from "../../domain/errors.ts";

// dv is git-coupled (.claude/CLAUDE.md § Strong opinions). The repo root is
// the working tree's top-level directory, located by `git rev-parse`. If
// invoked outside a git working tree, callers decide whether to fall back to
// cwd or error.

export async function findRepoRoot(): Promise<string | null> {
  const cmd = new Deno.Command("git", {
    args: ["rev-parse", "--show-toplevel"],
    stdout: "piped",
    stderr: "piped",
  });
  let output: Deno.CommandOutput;
  try {
    output = await cmd.output();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new DvError({
        code: "git-missing",
        message: "git is required but was not found on PATH",
        hint: "install git from https://git-scm.com/ and ensure it's on PATH",
        cause: err,
      });
    }
    throw err;
  }
  if (!output.success) return null;
  return new TextDecoder().decode(output.stdout).trim() || null;
}

export async function requireRepoRoot(): Promise<string> {
  const root = await findRepoRoot();
  if (!root) {
    throw new DvError({
      code: "not-a-git-repo",
      message: "not inside a git repository (dv requires git)",
      hint: "run `git init` first; dv assumes a git working tree",
    });
  }
  return root;
}
