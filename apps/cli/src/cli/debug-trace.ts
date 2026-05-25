import type {
  InvocationFailure,
  InvocationOutcome,
  InvocationTrace,
  TracingHooks,
} from "../subtools/plugin/mod.ts";
import { makeStyler, type Styler } from "./styler.ts";

// The tool-wide `--debug` reporter: emits a structured trace of every
// plugin invocation to stderr so authors can answer "why did my
// plugin fail inside dv version" without re-running it through
// `dv plugin invoke`. Off by default — leaves pass it through only
// when the binary boundary saw `--debug` on argv.
//
// stderr-only by design: stdout stays reserved for the leaf's own
// output (human summary or `--json` envelope), and tracing must
// coexist cleanly with both. The format is human-tuned (one block
// per invocation, indented body, color anchors); machine-readable
// per-op debugging is what `dv plugin invoke` is for.

export interface MakeStderrTracingHooksArgs {
  colorEnabled: boolean;
}

export function makeStderrTracingHooks(
  args: MakeStderrTracingHooksArgs,
): TracingHooks {
  const styler = makeStyler(args.colorEnabled);
  return {
    before(trace) {
      writeBlock(renderBefore({ trace, styler }));
    },
    after(trace, outcome) {
      writeBlock(renderAfter({ trace, outcome, styler }));
    },
    error(trace, failure) {
      writeBlock(renderError({ trace, failure, styler }));
    },
  };
}

interface RenderBeforeArgs {
  trace: InvocationTrace;
  styler: Styler;
}

function renderBefore(args: RenderBeforeArgs): string {
  const { trace, styler } = args;
  const headerLine = `${styler.dim("[dv:debug]")} ${styler.cyan("▶")} ${styler.bold(trace.opName)} via ${trace.pluginPath}`;
  const bodyLines = [
    `  ${styler.dim("exec")}: ${trace.executablePath} ${trace.executableArgv.join(" ")}`,
    `  ${styler.dim("env")}: ${renderEnv(trace.environmentVariables)}`,
    `  ${styler.dim("stdin")}: ${renderStdin(trace.stdinPayload)}`,
    `  ${styler.dim("timeout")}: ${renderTimeout(trace.timeoutMs)}`,
  ];
  return [headerLine, ...bodyLines].join("\n");
}

interface RenderAfterArgs {
  trace: InvocationTrace;
  outcome: InvocationOutcome;
  styler: Styler;
}

function renderAfter(args: RenderAfterArgs): string {
  const { trace, outcome, styler } = args;
  const headerLine = `${styler.dim("[dv:debug]")} ${styler.green("✓")} ${styler.bold(trace.opName)} ${styler.dim(`(${formatDurationMs(outcome.durationMs)})`)}`;
  const bodyLines = [
    `  ${styler.dim("exit")}: ${outcome.exitCode}`,
    `  ${styler.dim("stdout")}: ${renderCapturedStream(outcome.rawStdout)}`,
    `  ${styler.dim("stderr")}: ${renderCapturedStream(outcome.rawStderr)}`,
  ];
  return [headerLine, ...bodyLines].join("\n");
}

interface RenderErrorArgs {
  trace: InvocationTrace;
  failure: InvocationFailure;
  styler: Styler;
}

function renderError(args: RenderErrorArgs): string {
  const { trace, failure, styler } = args;
  const headerLine = `${styler.dim("[dv:debug]")} ${styler.red("✗")} ${styler.bold(trace.opName)} ${styler.red(failure.errorCode)} ${styler.dim(`(${formatDurationMs(failure.durationMs)})`)}`;
  const bodyLines = [
    `  ${styler.dim("stdout")}: ${renderCapturedStream(failure.rawStdout)}`,
    `  ${styler.dim("stderr")}: ${renderCapturedStream(failure.rawStderr)}`,
  ];
  return [headerLine, ...bodyLines].join("\n");
}

function writeBlock(block: string): void {
  // One write per invocation event, with a trailing newline so
  // blocks separate cleanly. We don't fight for the terminal — if a
  // progress reporter is also writing, the trace just interleaves
  // with it (both go to stderr).
  console.error(block);
}

// dv-controlled env vars are the only ones worth surfacing in the
// debug trace. Inherited env (PATH, HOME, terminal settings) would
// dwarf the actually-interesting per-op vars and leak credentials
// from CI environments. dv's contract guarantees every plugin-
// facing env var starts with DV_, so filtering on that prefix is
// the natural cut.
function renderEnv(environmentVariables: Record<string, string>): string {
  const dvEntries = Object.entries(environmentVariables)
    .filter(([key]) => key.startsWith("DV_"))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  if (dvEntries.length === 0) return "(none)";
  return dvEntries
    .map(([key, value]) => `${key}=${truncateForTrace(value, 200)}`)
    .join(" ");
}

function renderStdin(stdinPayload: string | undefined): string {
  if (stdinPayload === undefined) return "(none)";
  if (stdinPayload === "") return "(empty)";
  return truncateForTrace(stdinPayload, 500);
}

function renderTimeout(timeoutMs: number | undefined): string {
  if (timeoutMs === undefined) return "none";
  return `${timeoutMs}ms`;
}

function renderCapturedStream(captured: string): string {
  if (captured === "") return "(empty)";
  return truncateForTrace(captured, 1000);
}

// Captured stdout/stderr from a plugin can be arbitrarily large.
// We cap each rendered field so a chatty plugin doesn't drown the
// trace — the underlying error still carries the full text if dv
// needs to display it.
function truncateForTrace(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text;
  const truncatedHead = text.slice(0, maxCharacters);
  const omittedCount = text.length - maxCharacters;
  return `${truncatedHead}… (${omittedCount} more chars)`;
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs.toFixed(0)}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}
