// POSIX-style tokenization of a command-line string. Used by both
// the $EDITOR / $VISUAL parser in cli/parse-editor-command.ts and
// the `run:` arm of the plugin reference in discovery/resolve.ts —
// each wraps this in its own domain-specific DvError mapping.
//
// Honors:
//   - single quotes: literal, no escapes
//   - double quotes: literal except `\` escapes `"`, `\`, and newline
//   - unquoted backslash: escapes the next character
//   - unquoted whitespace: token separator
//
// Variable expansion (`$VAR`) and command substitution (` `cmd` `)
// are deliberately NOT performed — those would happen in the
// user's shell before the value reached us; re-expanding here
// would mean double-expansion and surprise.
//
// Failures throw `PosixTokenizeError` with a `kind` discriminator
// so callers can map to their own DvError variants without doing
// string-matching on the message.

export type PosixTokenizeErrorKind =
  | "empty"
  | "unterminated-single-quote"
  | "unterminated-double-quote"
  | "trailing-backslash"
  | "trailing-backslash-in-double-quote";

export class PosixTokenizeError extends Error {
  readonly kind: PosixTokenizeErrorKind;
  constructor(kind: PosixTokenizeErrorKind, message: string) {
    super(message);
    this.name = "PosixTokenizeError";
    this.kind = kind;
  }
}

// Tokenizes `rawInput` and returns the resulting argv array.
// Throws `PosixTokenizeError` if the input is malformed; returns
// at least one element on success (an empty/whitespace-only input
// is the "empty" error case).
export function posixTokenize(rawInput: string): string[] {
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
        throw new PosixTokenizeError(
          "trailing-backslash",
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
  if (tokens.length === 0) {
    throw new PosixTokenizeError("empty", "input is empty or whitespace-only");
  }
  return tokens;
}

interface ConsumeQuotedArgs {
  rawInput: string;
  startAfterOpeningQuote: number;
  appendChar: (charToAppend: string) => void;
}

function consumeSingleQuoted(args: ConsumeQuotedArgs): number {
  // Inside single quotes everything is literal. No escapes, no
  // nested quotes — the only thing that ends the token-fragment
  // is the next single quote.
  let cursor = args.startAfterOpeningQuote;
  while (cursor < args.rawInput.length) {
    const char = args.rawInput[cursor];
    if (char === "'") return cursor + 1;
    if (char !== undefined) args.appendChar(char);
    cursor += 1;
  }
  throw new PosixTokenizeError(
    "unterminated-single-quote",
    "unterminated single quote",
  );
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
        throw new PosixTokenizeError(
          "trailing-backslash-in-double-quote",
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
  throw new PosixTokenizeError(
    "unterminated-double-quote",
    "unterminated double quote",
  );
}
