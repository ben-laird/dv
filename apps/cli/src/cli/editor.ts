import { join } from "@std/path";
import type { ChangeType } from "../domain/change-type.ts";
import { DvError } from "../domain/errors.ts";
import { CONFIG_DIR } from "../subtools/config/mod.ts";
import { parseEditorCommand } from "./parse-editor-command.ts";

// Opens the user's editor on a contextual template for `dv add`'s
// interactive flow (specs/cli.md § dv add). Resolution chain:
// $EDITOR → $VISUAL → platform default (`vi` on Unix, `notepad` on
// Windows). HTML-comment blocks are stripped from the result; an
// empty body after stripping signals "abort with no file written"
// to the caller.
//
// The editor value goes through a POSIX-style tokenizer
// (parse-editor-command.ts) so quoted paths, escaped spaces, and
// single-quoted args all behave the way `$EDITOR` does in any other
// tool. Falls back to the platform default if EDITOR / VISUAL parse
// fails or is empty.
//
// Temp file location: we write inside `<repoRoot>/.changelog/` (not
// the OS temp dir) so editors like VSCode treat the file as part of
// the trusted workspace and skip the "untrusted file" warning. This
// matches git's pattern (it writes to `.git/COMMIT_EDITMSG`). A
// .gitignore entry catches leftovers if the editor crashes.

const RECORD_EDIT_FILE_PREFIX = ".dv-record-edit-";

interface ResolveRecordEditDirectoryArgs {
  repoRootPath: string;
}

// Pure helper: where dv writes the in-progress edit file. Exported for
// the unit test; lives in this module so it stays close to its only
// caller.
export function resolveRecordEditDirectory(
  args: ResolveRecordEditDirectoryArgs,
): string {
  return join(args.repoRootPath, CONFIG_DIR);
}

interface OpenEditorForRecordBodyArgs {
  changeType: ChangeType;
  packageNames: string[];
  // Repo root — the temp file is created under
  // `<repoRoot>/.changelog/` so VSCode (and similar editors) inherit
  // workspace trust.
  repoRootPath: string;
  // Overrides $EDITOR / $VISUAL for this invocation only. Passed via
  // `dv add --editor "<cmd>"` so the user can try a one-off editor
  // without touching their shell rc.
  editorOverride?: string;
}

export async function openEditorForRecordBody(
  args: OpenEditorForRecordBodyArgs,
): Promise<string> {
  const editorTemplate = renderEditorTemplate(args);
  const editDirectory = resolveRecordEditDirectory({
    repoRootPath: args.repoRootPath,
  });
  await Deno.mkdir(editDirectory, { recursive: true });
  const temporaryFilePath = await Deno.makeTempFile({
    dir: editDirectory,
    prefix: RECORD_EDIT_FILE_PREFIX,
    suffix: ".md",
  });
  try {
    await Deno.writeTextFile(temporaryFilePath, editorTemplate);
    await launchEditorProcess({
      filePath: temporaryFilePath,
      editorOverride: args.editorOverride,
    });
    const afterEdit = await Deno.readTextFile(temporaryFilePath);
    return stripHtmlComments(afterEdit).trim();
  } finally {
    try {
      await Deno.remove(temporaryFilePath);
    } catch {
      // best-effort cleanup
    }
  }
}

interface RenderEditorTemplateArgs {
  changeType: ChangeType;
  packageNames: string[];
}

function renderEditorTemplate(args: RenderEditorTemplateArgs): string {
  // The template body itself must NOT contain a literal `<!--` — that
  // would open a nested comment inside the outer one, and
  // stripHtmlComments uses a non-greedy match that would close on the
  // *inner* `-->`, leaking the rest of the template into the user's
  // record. The help text describes the rule in prose instead of
  // demonstrating the syntax.
  //
  // The scaffolded h1 line below is what the CHANGELOG renderer lifts
  // as the bullet headline (see subtools/changelog/render.ts:
  // extractHeadline). Writing it as `# headline` keeps each record a
  // valid standalone markdown document (MD041) while still rendering
  // cleanly into per-Package CHANGELOG.md files.
  return `<!--
type: ${args.changeType}
packages: ${args.packageNames.join(", ")}

Write what should appear in the CHANGELOG below.
The first \`# Headline\` line becomes the CHANGELOG bullet; further
paragraphs live in the record for PR reviewers but are not rendered.
Lines in this comment block are stripped before saving.
An empty body aborts without writing the file.
-->

#

`;
}

interface LaunchEditorProcessArgs {
  filePath: string;
  editorOverride?: string;
}

async function launchEditorProcess(
  args: LaunchEditorProcessArgs,
): Promise<void> {
  const { command: editorCommand, commandArgs: editorArgs } =
    resolveEditorCommand({ editorOverride: args.editorOverride });
  const fullArgs = [...editorArgs, args.filePath];
  const editorResult = await new Deno.Command(editorCommand, {
    args: fullArgs,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!editorResult.success) {
    throw new DvError(
      "editor-failed",
      `editor '${editorCommand}' exited ${editorResult.code}`,
    );
  }
}

interface EditorCommandSpec {
  command: string;
  commandArgs: string[];
}

interface ResolveEditorCommandArgs {
  editorOverride?: string;
}

function resolveEditorCommand(
  args: ResolveEditorCommandArgs,
): EditorCommandSpec {
  const candidateValue =
    args.editorOverride ?? Deno.env.get("EDITOR") ?? Deno.env.get("VISUAL");
  const sourceLabel = args.editorOverride !== undefined ? "--editor" : "EDITOR";
  if (candidateValue !== undefined && candidateValue.trim().length > 0) {
    try {
      return parseEditorCommand(candidateValue);
    } catch (caughtError) {
      // Re-throw with context so the user sees both the source of the
      // bad value (--editor flag vs EDITOR/VISUAL env var) and what
      // they actually passed. A malformed value should NOT fall back
      // silently to vi/notepad — that would mask user intent.
      if (
        caughtError instanceof DvError &&
        caughtError.code === "editor-parse"
      ) {
        throw new DvError(
          "editor-parse",
          `${sourceLabel}='${candidateValue}' did not parse: ${caughtError.message}`,
        );
      }
      throw caughtError;
    }
  }
  const isWindows = Deno.build.os === "windows";
  return { command: isWindows ? "notepad" : "vi", commandArgs: [] };
}

// Strips HTML-comment blocks (`<!-- ... -->`) from the body. Multi-line
// comment blocks are honored; nested comments aren't a thing in HTML and
// we don't try to handle them. The intent matches cli.md: instructional
// scaffolding goes in comments; the user writes prose outside them.
function stripHtmlComments(rawBody: string): string {
  return rawBody.replace(/<!--[\s\S]*?-->/g, "");
}
