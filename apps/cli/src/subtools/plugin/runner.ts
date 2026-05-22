import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";

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
}

export interface InvokeOpResult {
  rawStdout: string;
  rawStderr: string;
}

export async function invokeOp(args: InvokeOpArgs): Promise<InvokeOpResult> {
  const { resolvedPlugin, opName } = args;
  const executablePath =
    resolvedPlugin.kind === "single"
      ? resolvedPlugin.path
      : join(resolvedPlugin.path, opName);
  const executableArgv = resolvedPlugin.kind === "single" ? [opName] : [];

  const childEnvironment: Record<string, string> = {
    ...(args.environmentVariables ?? {}),
  };
  childEnvironment.DV_OPERATION = opName;

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
      throw new DvError({
        code: "plugin-not-executable",
        message: `plugin executable not found: ${executablePath}`,
        hint: "check the plugin path; for directory plugins the op name must exist as a child file",
        context: { pluginPath: executablePath, opName },
        cause: caughtError,
      });
    }
    if (caughtError instanceof Deno.errors.PermissionDenied) {
      throw new DvError({
        code: "plugin-not-executable",
        message: `plugin not executable (chmod +x?): ${executablePath}`,
        hint: "run `chmod +x` on the plugin file",
        context: { pluginPath: executablePath, opName },
        cause: caughtError,
      });
    }
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
    throw caughtError;
  }
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

  const rawStdout = new TextDecoder().decode(processOutput.stdout);
  const rawStderr = new TextDecoder().decode(processOutput.stderr);
  if (!processOutput.success) {
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
  return { rawStdout, rawStderr };
}
