import { DvError } from "../domain/errors.ts";

// POSIX-style tokenization of an $EDITOR / $VISUAL string. Honors:
//   - single quotes: literal, no escapes
//   - double quotes: literal except `\` escapes `"`, `\`, and newline
//   - unquoted backslash: escapes the next character
//   - unquoted whitespace: token separator
//
// Variable expansion (`$VAR`) and command substitution (` `cmd` `) are
// deliberately NOT performed — those happen in the user's shell before
// $EDITOR is set; if dv re-expanded them here we'd be at risk of
// double-expansion and surprise.
//
// Unterminated quotes throw DvError("editor-parse"). An empty token
// from explicit `""` or `''` is preserved (rare but legal — some
// editors accept empty argv positions).

export interface EditorCommandSpec {
  command: string;
  commandArgs: string[];
}

export function parseEditorCommand(rawEditorValue: string): EditorCommandSpec {
  const tokens = tokenize(rawEditorValue);
  if (tokens.length === 0) {
    throw new DvError(
      "editor-parse",
      "EDITOR / VISUAL value is empty or whitespace-only",
    );
  }
  const [commandToken, ...argumentTokens] = tokens;
  if (commandToken === undefined) {
    // Unreachable given the length check above, but the narrowing
    // keeps the type system honest without a non-null assertion.
    throw new DvError("editor-parse", "EDITOR resolved to no tokens");
  }
  return { command: commandToken, commandArgs: argumentTokens };
}

function tokenize(rawInput: string): string[] {
  const tokens: string[] = [];
  let currentToken = "";
  let isBuildingToken = false;
  let index = 0;
  while (index < rawInput.length) {
    const char = rawInput[index];
    if (char === "'") {
      isBuildingToken = true;
      index = consumeSingleQuoted({
        rawInput,
        startAfterOpeningQuote: index + 1,
        appendChar: (charToAppend) => {
          currentToken += charToAppend;
        },
      });
      continue;
    }
    if (char === '"') {
      isBuildingToken = true;
      index = consumeDoubleQuoted({
        rawInput,
        startAfterOpeningQuote: index + 1,
        appendChar: (charToAppend) => {
          currentToken += charToAppend;
        },
      });
      continue;
    }
    if (char === "\\") {
      const nextChar = rawInput[index + 1];
      if (nextChar === undefined) {
        throw new DvError(
          "editor-parse",
          "trailing backslash with nothing to escape",
        );
      }
      currentToken += nextChar;
      isBuildingToken = true;
      index += 2;
      continue;
    }
    if (char !== undefined && /\s/.test(char)) {
      if (isBuildingToken) {
        tokens.push(currentToken);
        currentToken = "";
        isBuildingToken = false;
      }
      index += 1;
      continue;
    }
    if (char !== undefined) {
      currentToken += char;
      isBuildingToken = true;
    }
    index += 1;
  }
  if (isBuildingToken) tokens.push(currentToken);
  return tokens;
}

interface ConsumeQuotedArgs {
  rawInput: string;
  startAfterOpeningQuote: number;
  appendChar: (charToAppend: string) => void;
}

function consumeSingleQuoted(args: ConsumeQuotedArgs): number {
  // Inside single quotes everything is literal. No escapes, no nested
  // quotes — the only thing that ends the token-fragment is the next
  // single quote.
  let cursor = args.startAfterOpeningQuote;
  while (cursor < args.rawInput.length) {
    const char = args.rawInput[cursor];
    if (char === "'") return cursor + 1;
    if (char !== undefined) args.appendChar(char);
    cursor += 1;
  }
  throw new DvError("editor-parse", "unterminated single quote");
}

function consumeDoubleQuoted(args: ConsumeQuotedArgs): number {
  // Inside double quotes, backslash escapes a small set (`"`, `\`,
  // newline) — every other backslash is literal. Single quotes are
  // ordinary characters inside double quotes.
  let cursor = args.startAfterOpeningQuote;
  while (cursor < args.rawInput.length) {
    const char = args.rawInput[cursor];
    if (char === '"') return cursor + 1;
    if (char === "\\") {
      const nextChar = args.rawInput[cursor + 1];
      if (nextChar === undefined) {
        throw new DvError(
          "editor-parse",
          "trailing backslash inside double quotes",
        );
      }
      if (nextChar === '"' || nextChar === "\\" || nextChar === "\n") {
        args.appendChar(nextChar);
        cursor += 2;
        continue;
      }
      // Backslash before any other char inside double quotes is
      // literal — append both.
      args.appendChar(char);
      args.appendChar(nextChar);
      cursor += 2;
      continue;
    }
    if (char !== undefined) args.appendChar(char);
    cursor += 1;
  }
  throw new DvError("editor-parse", "unterminated double quote");
}
