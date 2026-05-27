import { CliError } from "./errors.ts";

// Renders a CliError tree to a string for either human stderr or
// the --json error envelope. Pure: caller `console.error`s the
// result. Mode is the caller's signal (typically derived from their
// own `--json` flag). Color in human mode is gated on `colorEnabled`
// — caller resolves that (NO_COLOR, --no-color, TTY detection live
// in the consumer, not the framework).
//
// Human format:
//
//   error[<code>]: <message>
//     hint: <hint text>
//     ✗ <sub-error message> (<context summary>)
//     ✗ <sub-error message>
//
// Sub-errors recurse one level deeper per nesting level, depth-
// capped at 5 to avoid runaway. JSON format wraps `err.toJSON()` in
// a `{ schema, error }` envelope that matches the documented v1
// automation-surface contract.

const SUB_ERROR_DEPTH_CAP = 5;

export interface RenderCliErrorArgs {
  err: CliError;
  mode: "human" | "json";
  colorEnabled: boolean;
}

export function renderCliError(args: RenderCliErrorArgs): string {
  if (args.mode === "json") {
    return renderJsonEnvelope(args.err);
  }
  return renderHuman({ err: args.err, colorEnabled: args.colorEnabled });
}

function renderJsonEnvelope(err: CliError): string {
  return JSON.stringify(
    {
      schema: "urn:dv:schema:v1:cli-error",
      error: err.toJSON(),
    },
    null,
    2,
  );
}

interface RenderHumanArgs {
  err: CliError;
  colorEnabled: boolean;
}

function renderHuman(args: RenderHumanArgs): string {
  const styler = makeStyler(args.colorEnabled);
  const lines: string[] = [];
  appendErrorLines({
    err: args.err,
    styler,
    indentDepth: 0,
    isRoot: true,
    lines,
  });
  return lines.join("\n");
}

interface AppendErrorLinesArgs {
  err: CliError;
  styler: Styler;
  indentDepth: number;
  isRoot: boolean;
  lines: string[];
}

function appendErrorLines(args: AppendErrorLinesArgs): void {
  const indent = "  ".repeat(args.indentDepth);
  const code = args.err.kind.code;
  const contextSummary = summarizeContext(args.err.kind);

  if (args.isRoot) {
    // Top-level errors lead with `error[code]: message`. The
    // consumer prefixes the binary name (e.g. `dv `) outside this
    // function — keeping the prefix consumer-defined lets other
    // CLIs use the same renderer.
    args.lines.push(
      `${args.styler.bold("error")}${args.styler.dim(`[${code}]`)}: ${args.err.message}`,
    );
  } else {
    // Sub-errors lead with a ✗ marker so the eye finds them quickly
    // when scanning a partial-failure report.
    const contextSuffix = contextSummary.length > 0
      ? ` ${args.styler.dim(`(${contextSummary})`)}`
      : "";
    args.lines.push(
      `${indent}${args.styler.dim("✗")} ${args.err.message}${contextSuffix}`,
    );
  }

  if (args.err.hint !== undefined) {
    args.lines.push(
      `${indent}  ${args.styler.dim("hint:")} ${args.err.hint}`,
    );
  }

  if (args.indentDepth >= SUB_ERROR_DEPTH_CAP) return;
  for (const subError of args.err.subErrors) {
    appendErrorLines({
      err: subError,
      styler: args.styler,
      indentDepth: args.indentDepth + 1,
      isRoot: false,
      lines: args.lines,
    });
  }
}

// Picks the most useful one-or-two context fields for the sub-error
// summary line. Falls back to a generic "k=v" join. The full context
// is always available via JSON output; this is just for human
// readability in aggregated reports.
function summarizeContext(kind: { context?: Record<string, unknown> }): string {
  const context = kind.context;
  if (context === undefined) return "";
  // Prefer commonly-meaningful keys when present.
  const preferredKeys = ["package", "tag", "pluginPath", "path", "file"];
  const preferredSegments: string[] = [];
  for (const key of preferredKeys) {
    if (key in context && typeof context[key] === "string") {
      preferredSegments.push(`${key}: ${context[key]}`);
    }
  }
  if (preferredSegments.length > 0) return preferredSegments.join(", ");
  // No preferred keys hit — synthesize a short kv list from whatever
  // is there, capped at 80 chars so a sprawling context doesn't blow
  // up the line.
  const allSegments = Object.entries(context).map(
    ([key, value]) => `${key}=${String(value)}`,
  );
  const joined = allSegments.join(", ");
  return joined.length > 80 ? `${joined.slice(0, 77)}...` : joined;
}

interface Styler {
  bold(text: string): string;
  dim(text: string): string;
}

function makeStyler(colorEnabled: boolean): Styler {
  if (!colorEnabled) {
    return { bold: (t) => t, dim: (t) => t };
  }
  return {
    bold: (text) => `\x1b[1m${text}\x1b[22m`,
    dim: (text) => `\x1b[2m${text}\x1b[22m`,
  };
}
