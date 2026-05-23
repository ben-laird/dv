import { makeStyler, type Styler } from "./styler.ts";

// Live per-stage progress reporter for long-running commands
// (dv version, dv release). Pattern matches `deno task gate`:
//   ▸ orders   write-version   ok (45ms)
//
// One line per (package, op) pair, written to stderr so stdout stays
// reserved for the final summary or --json envelope. Suppressed
// entirely under --json (machine consumers don't want progress
// noise) and gracefully no-op when the caller picks the silent
// implementation.
//
// Why an interface: the runners can be tested with the silent
// implementation, so progress IO doesn't pollute test stderr or
// require capturing it. The runtime decision (live vs silent)
// happens at the command boundary in main.ts.

export interface ProgressReporter {
  // Marks the start of a step. The returned `done` / `fail` close
  // out the line (printing the duration); callers should always
  // call exactly one of them. The two-step API exists so the
  // reporter can render an in-progress hint mid-step in a future
  // iteration (spinner, partial dim text) without changing the
  // call sites.
  start(args: ProgressStartArgs): ProgressStep;
}

export interface ProgressStartArgs {
  // Per-package label — short, fixed-width within a single run.
  // Empty string for package-less phases (e.g. "git commit").
  packageName: string;
  // The operation being performed. Kept short so the column
  // alignment stays useful (write-version, changelog, cascade,
  // commit, mint-tag, release).
  operationName: string;
}

export interface ProgressStep {
  done(): void;
  // Records the step as failed. The duration is rendered the same;
  // the marker switches from `ok` to `FAILED` and goes red. Callers
  // typically throw immediately after; the reporter just guarantees
  // the line is closed out so the next command's output doesn't
  // overlap a half-rendered progress line.
  fail(failureNote?: string): void;
}

interface MakeLiveProgressReporterArgs {
  colorEnabled: boolean;
  // Column widths for alignment. Computed by the caller from the
  // known set of (package, op) pairs before the first start() call.
  // The reporter doesn't know the full schedule, so it can't
  // compute these itself.
  packageColumnWidth: number;
  operationColumnWidth: number;
}

export function makeLiveProgressReporter(
  args: MakeLiveProgressReporterArgs,
): ProgressReporter {
  const styler = makeStyler(args.colorEnabled);
  return {
    start(stepArgs: ProgressStartArgs): ProgressStep {
      const startedAtMs = performance.now();
      const paddedPackage = stepArgs.packageName.padEnd(
        args.packageColumnWidth,
      );
      const paddedOp = stepArgs.operationName.padEnd(args.operationColumnWidth);
      // Print the lead-in immediately, then either replace the
      // entire line via \r when the step ends (so cursor stays on
      // the same row across runs) — but Deno's TTY handling for
      // multi-line interleaving is fiddly when other tools also
      // write to stderr. Simplest correct thing: emit one full
      // line per step at completion time, not at start. The
      // "interactive" feel is preserved because the lines stream
      // in as each step finishes, instead of all at once at the
      // end. Spinners are a future iteration.
      return {
        done(): void {
          writeLine({
            styler,
            packageName: paddedPackage,
            operationName: paddedOp,
            durationMs: performance.now() - startedAtMs,
            outcome: "ok",
          });
        },
        fail(failureNote?: string): void {
          writeLine({
            styler,
            packageName: paddedPackage,
            operationName: paddedOp,
            durationMs: performance.now() - startedAtMs,
            outcome: "fail",
            failureNote,
          });
        },
      };
    },
  };
}

export function makeSilentProgressReporter(): ProgressReporter {
  return {
    start(): ProgressStep {
      return {
        done() {
          // no-op
        },
        fail() {
          // no-op
        },
      };
    },
  };
}

interface WriteLineArgs {
  styler: Styler;
  packageName: string;
  operationName: string;
  durationMs: number;
  outcome: "ok" | "fail";
  failureNote?: string;
}

function writeLine(args: WriteLineArgs): void {
  const outcomeLabel =
    args.outcome === "ok" ? args.styler.green("ok") : args.styler.red("FAILED");
  const failureSuffix =
    args.outcome === "fail" && args.failureNote !== undefined
      ? `: ${args.styler.dim(args.failureNote)}`
      : "";
  const line = `${args.styler.dim("▸")} ${args.packageName}  ${args.operationName}  ${outcomeLabel} ${args.styler.dim(`(${formatDuration(args.durationMs)})`)}${failureSuffix}`;
  // Write to stderr so progress doesn't mix into the stdout
  // summary or --json envelope.
  Deno.stderr.writeSync(new TextEncoder().encode(`${line}\n`));
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}
