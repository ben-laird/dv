import { assertEquals, assertThrows } from "@std/assert";
import { DvError } from "../domain/errors.ts";
import { parseEditorCommand } from "./parse-editor-command.ts";

interface ParseCase {
  rawInput: string;
  expectedCommand: string;
  expectedArgs: string[];
  description: string;
}

const PARSE_CASES: ParseCase[] = [
  {
    rawInput: "code --wait",
    expectedCommand: "code",
    expectedArgs: ["--wait"],
    description: "simple command + flag (the original case main.ts handled)",
  },
  {
    rawInput: "vi",
    expectedCommand: "vi",
    expectedArgs: [],
    description: "command with no arguments",
  },
  {
    rawInput: "  code   --wait   ",
    expectedCommand: "code",
    expectedArgs: ["--wait"],
    description: "leading, trailing, and runs of whitespace are ignored",
  },
  {
    rawInput:
      '"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --wait',
    expectedCommand:
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    expectedArgs: ["--wait"],
    description: "double-quoted path with spaces (the macOS app bundle case)",
  },
  {
    rawInput: "/path/with\\ spaces/editor --flag",
    expectedCommand: "/path/with spaces/editor",
    expectedArgs: ["--flag"],
    description: "unquoted backslash-escaped space inside a path",
  },
  {
    rawInput: "vim -c 'set ft=markdown'",
    expectedCommand: "vim",
    expectedArgs: ["-c", "set ft=markdown"],
    description: "single-quoted argument preserves its spaces literally",
  },
  {
    rawInput: 'emacs -nw --eval "(message \\"hi\\")"',
    expectedCommand: "emacs",
    expectedArgs: ["-nw", "--eval", '(message "hi")'],
    description: "double-quoted argument with escaped inner quotes",
  },
  {
    rawInput: "'/usr/local/bin/code' --wait '--user-data-dir=/tmp/d'",
    expectedCommand: "/usr/local/bin/code",
    expectedArgs: ["--wait", "--user-data-dir=/tmp/d"],
    description: "single quotes around both command and argument",
  },
];

Deno.test("parseEditorCommand tokenizes EDITOR-style values per POSIX-shell rules", () => {
  // Given each documented input case
  for (const parseCase of PARSE_CASES) {
    // When parsed
    const parsed = parseEditorCommand(parseCase.rawInput);

    // Then the command and args match expectations
    assertEquals(
      parsed.command,
      parseCase.expectedCommand,
      `command for '${parseCase.rawInput}' (${parseCase.description})`,
    );
    assertEquals(
      parsed.commandArgs,
      parseCase.expectedArgs,
      `args for '${parseCase.rawInput}' (${parseCase.description})`,
    );
  }
});

Deno.test("parseEditorCommand throws DvError('editor-parse') for an empty value", () => {
  // Given an empty or whitespace-only EDITOR value
  // When parsed
  // Then DvError surfaces with the documented code so the caller can
  // fall back to the platform default
  const caughtEmpty = assertThrows(() => parseEditorCommand(""), DvError);
  assertEquals(caughtEmpty.kind.code, "editor-parse");
  const caughtWhitespace = assertThrows(
    () => parseEditorCommand("   "),
    DvError,
  );
  assertEquals(caughtWhitespace.kind.code, "editor-parse");
});

Deno.test("parseEditorCommand throws DvError('editor-parse') for an unterminated single quote", () => {
  // Given a string that opens a single quote and never closes it
  // When parsed
  // Then DvError surfaces — silently truncating would hide a typo
  const caughtError = assertThrows(
    () => parseEditorCommand("vim -c 'set ft=markdown"),
    DvError,
  );
  assertEquals(caughtError.kind.code, "editor-parse");
});

Deno.test("parseEditorCommand throws DvError('editor-parse') for an unterminated double quote", () => {
  // Given a string that opens a double quote and never closes it
  // When parsed
  // Then DvError surfaces
  const caughtError = assertThrows(
    () => parseEditorCommand('"/path/with space/editor'),
    DvError,
  );
  assertEquals(caughtError.kind.code, "editor-parse");
});

Deno.test("parseEditorCommand throws DvError('editor-parse') for a trailing backslash with nothing to escape", () => {
  // Given a trailing-backslash input (likely a copy-paste from a
  // multi-line shell value)
  // When parsed
  // Then DvError surfaces
  const caughtError = assertThrows(
    () => parseEditorCommand("code --wait\\"),
    DvError,
  );
  assertEquals(caughtError.kind.code, "editor-parse");
});
