import type { ChangeType } from "../domain/change-type.ts";
import { DvError } from "../domain/errors.ts";

// Opens the user's editor on a contextual template for `dv add`'s
// interactive flow (specs/cli.md § dv add). Resolution chain:
// $EDITOR → $VISUAL → platform default (`vi` on Unix, `notepad` on
// Windows). HTML-comment blocks are stripped from the result; an
// empty body after stripping signals "abort with no file written"
// to the caller.

interface OpenEditorForRecordBodyArgs {
  changeType: ChangeType;
  packageNames: string[];
}

export async function openEditorForRecordBody(
  args: OpenEditorForRecordBodyArgs,
): Promise<string> {
  const editorTemplate = renderEditorTemplate(args);
  const temporaryFilePath = await Deno.makeTempFile({
    prefix: "dv-record-",
    suffix: ".md",
  });
  try {
    await Deno.writeTextFile(temporaryFilePath, editorTemplate);
    await launchEditorProcess({ filePath: temporaryFilePath });
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
  return `<!--
type: ${args.changeType}
packages: ${args.packageNames.join(", ")}

Write what should appear in the CHANGELOG below.
Lines wrapped in <!-- ... --> (like this block) are stripped before saving.
An empty body aborts without writing the file.
-->


`;
}

interface LaunchEditorProcessArgs {
  filePath: string;
}

async function launchEditorProcess(
  args: LaunchEditorProcessArgs,
): Promise<void> {
  const { command: editorCommand, commandArgs: editorArgs } =
    resolveEditorCommand();
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

function resolveEditorCommand(): EditorCommandSpec {
  const envEditor = Deno.env.get("EDITOR") ?? Deno.env.get("VISUAL");
  if (envEditor && envEditor.trim().length > 0) {
    const parts = envEditor.trim().split(/\s+/);
    return {
      command: parts[0]!,
      commandArgs: parts.slice(1),
    };
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
