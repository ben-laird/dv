import { DvError } from "../domain/errors.ts";
import {
  PosixTokenizeError,
  posixTokenize,
} from "../subtools/shell/posix-tokenize.ts";

// Tokenizes an $EDITOR / $VISUAL string into argv. Thin wrapper
// around the shared POSIX tokenizer in subtools/shell — this file
// is the editor-specific error mapping. The `run:` plugin arm in
// subtools/discovery/resolve.ts is the other consumer, with its
// own error mapping.

export interface EditorCommandSpec {
  command: string;
  commandArgs: string[];
}

export function parseEditorCommand(rawEditorValue: string): EditorCommandSpec {
  let tokens: string[];
  try {
    tokens = posixTokenize(rawEditorValue);
  } catch (caughtError) {
    if (caughtError instanceof PosixTokenizeError) {
      throw new DvError({
        code: "editor-parse",
        message:
          caughtError.kind === "empty"
            ? "EDITOR / VISUAL value is empty or whitespace-only"
            : caughtError.message,
        cause: caughtError,
      });
    }
    throw caughtError;
  }
  const [commandToken, ...argumentTokens] = tokens;
  if (commandToken === undefined) {
    // The tokenizer rejects empty input itself, so this branch is
    // unreachable — the narrowing keeps the type system happy.
    throw new DvError({
      code: "editor-parse",
      message: "EDITOR resolved to no tokens",
    });
  }
  return { command: commandToken, commandArgs: argumentTokens };
}
