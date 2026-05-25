// Optional tracing hooks threaded through invokeOp so callers can
// observe every plugin invocation without the runner needing to
// know about logging. Powers the tool-wide `--debug` flag:
// `main.ts` pre-scans for `--debug`, leaves install a stderr
// reporter, and dv version / release / status / etc. pass it
// through to every subtool invoker (read-version, write-version,
// finalize, release, discover, info...).
//
// The runner only knows the interface — concrete reporters live in
// the CLI layer (see `apps/cli/src/cli/debug-trace.ts`). Keeps the
// subtool dependency-free of UI / formatting concerns and lets
// tests inject a recording double trivially.

export interface InvocationTrace {
  pluginPath: string;
  opName: string;
  executablePath: string;
  executableArgv: string[];
  environmentVariables: Record<string, string>;
  stdinPayload?: string;
  timeoutMs?: number;
}

export interface InvocationOutcome {
  exitCode: number;
  durationMs: number;
  rawStdout: string;
  rawStderr: string;
}

export interface InvocationFailure {
  durationMs: number;
  // The error code (DvError.code) if the failure came through DvError,
  // or "uncaught" for everything else. The full error object is
  // not threaded — debug output only needs the high-level signal,
  // and the error itself is being thrown back to the caller anyway.
  errorCode: string;
  // Whatever the runner managed to capture before the failure.
  // Empty strings for cases where the child never wrote anything
  // (e.g. plugin-not-executable surfaces before spawn succeeds).
  rawStdout: string;
  rawStderr: string;
}

export interface TracingHooks {
  // Called just before spawn. The runner has resolved executable +
  // argv + env at this point but the child hasn't started.
  before(trace: InvocationTrace): void;
  // Called after a successful (exit 0) child completion.
  after(trace: InvocationTrace, outcome: InvocationOutcome): void;
  // Called when the child failed (non-zero exit, timeout, not-found,
  // not-executable). The hook fires before the runner throws so the
  // log line lands above the error.
  error(trace: InvocationTrace, failure: InvocationFailure): void;
}
