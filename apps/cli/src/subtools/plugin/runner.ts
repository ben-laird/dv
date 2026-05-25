import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import type { TracingHooks } from "./tracing.ts";

// Invokes a single plugin Op per specs/plugin-contract.md.
// JSON-over-stdio, op as argv[1] for single-executable plugins, op-named
// subcommand for directory plugins. Fast ops are bounded by a wall-clock
// timeout; exceeding it is a failure with no auto-retry.
//
// Cross-subtool: discovery's `discover` and versioning's `read-version` /
// `write-version` all flow through this same runner. The resolver lives
// in discovery because resolution is *its* job; the runner sits one
// level up because every subtool that talks to plugins uses it.

export interface InvokeOpArgs {
  resolvedPlugin: ResolvedPlugin;
  opName: string;
  environmentVariables?: Record<string, string>;
  stdinPayload?: string;
  timeoutMs?: number;
  // Optional observer for `--debug` style tracing. The runner
  // invokes before/after/error in order so a tracer can log the
  // full lifecycle of one child process. Default: no-op.
  tracingHooks?: TracingHooks;
}

export interface InvokeOpResult {
  rawStdout: string;
  rawStderr: string;
}

export async function invokeOp(args: InvokeOpArgs): Promise<InvokeOpResult> {
  const { resolvedPlugin, opName } = args;
  // Dispatch on plugin kind to compute the executable + argv:
  //   single     → call the file directly with [opName]
  //   dir        → call <dir>/<opName> with no args
  //   invocation → call the run:-string's first token with
  //                [...baseArgs, opName] (baseArgs are the static
  //                prefix the user supplied; opName is appended
  //                like the single case)
  let executablePath: string;
  let executableArgv: string[];
  if (resolvedPlugin.kind === "single") {
    executablePath = resolvedPlugin.path;
    executableArgv = [opName];
  } else if (resolvedPlugin.kind === "dir") {
    executablePath = join(resolvedPlugin.path, opName);
    executableArgv = [];
  } else {
    executablePath = resolvedPlugin.executable;
    executableArgv = [...resolvedPlugin.baseArgs, opName];
  }

  const childEnvironment: Record<string, string> = {
    ...(args.environmentVariables ?? {}),
  };
  childEnvironment.DV_OPERATION = opName;

  // Snapshot the full invocation up front so tracing hooks (and
  // the error path) see exactly what dv spawned.
  const invocationTrace = {
    pluginPath: resolvedPlugin.path,
    opName,
    executablePath,
    executableArgv,
    environmentVariables: childEnvironment,
    stdinPayload: args.stdinPayload,
    timeoutMs: args.timeoutMs,
  };
  args.tracingHooks?.before(invocationTrace);
  const startTimeMs = performance.now();

  const abortController = new AbortController();
  const timeoutHandle =
    args.timeoutMs !== undefined
      ? setTimeout(() => abortController.abort(), args.timeoutMs)
      : undefined;

  let childProcess: Deno.ChildProcess;
  try {
    childProcess = new Deno.Command(executablePath, {
      args: executableArgv,
      env: childEnvironment,
      stdin: args.stdinPayload !== undefined ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
      signal: abortController.signal,
    }).spawn();
  } catch (caughtError) {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (caughtError instanceof Deno.errors.NotFound) {
      args.tracingHooks?.error(invocationTrace, {
        durationMs: performance.now() - startTimeMs,
        errorCode: "plugin-not-executable",
        rawStdout: "",
        rawStderr: "",
      });
      throw new DvError({
        code: "plugin-not-executable",
        message: `plugin executable not found: ${executablePath}`,
        hint: "check the plugin path; for directory plugins the op name must exist as a child file",
        context: { pluginPath: executablePath, opName },
        cause: caughtError,
      });
    }
    if (caughtError instanceof Deno.errors.PermissionDenied) {
      args.tracingHooks?.error(invocationTrace, {
        durationMs: performance.now() - startTimeMs,
        errorCode: "plugin-not-executable",
        rawStdout: "",
        rawStderr: "",
      });
      throw new DvError({
        code: "plugin-not-executable",
        message: `plugin not executable (chmod +x?): ${executablePath}`,
        hint: "run `chmod +x` on the plugin file",
        context: { pluginPath: executablePath, opName },
        cause: caughtError,
      });
    }
    args.tracingHooks?.error(invocationTrace, {
      durationMs: performance.now() - startTimeMs,
      errorCode: "uncaught",
      rawStdout: "",
      rawStderr: "",
    });
    throw caughtError;
  }

  if (args.stdinPayload !== undefined && childProcess.stdin) {
    const stdinWriter = childProcess.stdin.getWriter();
    await stdinWriter.write(new TextEncoder().encode(args.stdinPayload));
    await stdinWriter.close();
  }

  let processOutput: Deno.CommandOutput;
  try {
    processOutput = await childProcess.output();
  } catch (caughtError) {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (abortController.signal.aborted) {
      args.tracingHooks?.error(invocationTrace, {
        durationMs: performance.now() - startTimeMs,
        errorCode: "plugin-timeout",
        rawStdout: "",
        rawStderr: "",
      });
      throw new DvError({
        code: "plugin-timeout",
        message: `plugin ${opName} timed out after ${args.timeoutMs}ms`,
        hint: "raise the per-Op timeout in config (e.g. discovery.plugins[i].timeout) or speed up the plugin",
        context: {
          pluginPath: executablePath,
          opName,
          timeoutMs: args.timeoutMs ?? 0,
        },
        cause: caughtError,
      });
    }
    args.tracingHooks?.error(invocationTrace, {
      durationMs: performance.now() - startTimeMs,
      errorCode: "uncaught",
      rawStdout: "",
      rawStderr: "",
    });
    throw caughtError;
  }
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

  const rawStdout = new TextDecoder().decode(processOutput.stdout);
  const rawStderr = new TextDecoder().decode(processOutput.stderr);
  const durationMs = performance.now() - startTimeMs;
  if (!processOutput.success) {
    args.tracingHooks?.error(invocationTrace, {
      durationMs,
      errorCode: "plugin-exit-nonzero",
      rawStdout,
      rawStderr,
    });
    const stderrDetail = rawStderr.trim() || `exit ${processOutput.code}`;
    throw new DvError({
      code: "plugin-exit-nonzero",
      message: `plugin ${opName} failed (exit ${processOutput.code}): ${stderrDetail}`,
      hint: "check the plugin's stderr above for the underlying error",
      context: {
        pluginPath: executablePath,
        opName,
        exitCode: processOutput.code,
      },
    });
  }
  args.tracingHooks?.after(invocationTrace, {
    exitCode: processOutput.code,
    durationMs,
    rawStdout,
    rawStderr,
  });
  return { rawStdout, rawStderr };
}
