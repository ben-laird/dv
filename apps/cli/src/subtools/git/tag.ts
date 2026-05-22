import type { GitSign } from "../../domain/config.ts";
import { DvError } from "../../domain/errors.ts";

// Mints an annotated git tag. Used by `dv release` to mark each
// Package's current Version as released (specs/language.md Algebra
// §4: release state lives entirely in Tags).
//
// Annotated rather than lightweight because annotated tags carry
// author/date/message metadata `git log --tags` can show. Lightweight
// tags are a polish item — adding a `--light` config field is the
// straightforward path if anyone asks.
//
// Signing follows the git.sign config option (specs/config-format.md
// § git.sign), same convention as commitChanges: 'auto' honors git's
// own tag.gpgsign config (no flag), true → -s, false → --no-sign.

export interface MintTagArgs {
  repoRootPath: string;
  tag: string;
  message: string;
  sign: GitSign;
}

export async function mintTag(args: MintTagArgs): Promise<void> {
  const tagArgv = [
    "-C",
    args.repoRootPath,
    "tag",
    "-a",
    args.tag,
    "-m",
    args.message,
  ];
  if (args.sign === true) tagArgv.push("-s");
  else if (args.sign === false) tagArgv.push("--no-sign");
  // sign === "auto" → pass no flag; git's own tag.gpgsign decides.

  const tagResult = await new Deno.Command("git", {
    args: tagArgv,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!tagResult.success) {
    const stderrText = new TextDecoder().decode(tagResult.stderr).trim();
    throw new DvError({
      code: "git-tag-failed",
      message: `failed to mint tag '${args.tag}': ${stderrText || `exit ${tagResult.code}`}`,
      hint: "the tag may already exist; check `git tag -l` and consider --force",
      context: { tag: args.tag },
    });
  }
}
