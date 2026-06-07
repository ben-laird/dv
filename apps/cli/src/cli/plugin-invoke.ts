import { DvError } from "../domain/errors.ts";
import { SCHEMA_URNS } from "../domain/schema-urns.ts";
import { resolvePlugin } from "../subtools/discovery/resolve.ts";
import {
  DV_CONTRACT_VERSION,
  invokeOp,
  parseDiscoverResponse,
  parseFinalizeResponse,
  parseGetDependenciesResponse,
  parseInfoResponse,
  parseReadVersionResponse,
  parseReleaseResponse,
  parseUpdateDependencyResponse,
  parseWriteVersionResponse,
  type TracingHooks,
} from "../subtools/plugin/mod.ts";
import { makeStderrTracingHooks } from "./debug-trace.ts";
import { parsePluginPositional } from "./parse-plugin-positional.ts";
import { makeStyler } from "./styler.ts";

// `dv plugin invoke <plugin> <op>` per specs/cli.md § dv plugin invoke.
// Single-Op debugger for plugin authors: no repo/config/Records required,
// just the plugin and the Op. Sets the env vars / stdin dv would set
// during a real run, prints the full exchange, and conformance-checks
// the response through the same Zod schemas the runtime uses.
//
// Routing through `resolvePlugin` + `invokeOp` + the per-Op
// `parse*Response` functions is the whole point — `dv plugin invoke`
// must observe the same resolution and validation behavior dv's real
// pipeline does, so a contract drift surfaces here too. No parallel
// implementation.

const DEFAULT_INVOKE_TIMEOUT_MS = 60_000;

/**
 * The closed set of plugin Op names `dv plugin invoke` can exercise, in
 * pipeline order. The source of truth for {@link PluginOpName}; consumers
 * iterate it to enumerate the contract surface (see `specs/plugin-contract.md`).
 */
export const PLUGIN_OP_NAMES = [
  "info",
  "discover",
  "read-version",
  "write-version",
  "update-dependency",
  "get-dependencies",
  "release",
  "finalize",
] as const;

/** Name of a plugin Op `dv plugin invoke` can exercise (`info`, `discover`, etc.). */
export type PluginOpName = (typeof PLUGIN_OP_NAMES)[number];

/** Narrow an arbitrary string to a {@link PluginOpName} type guard. */
export function isPluginOpName(value: string): value is PluginOpName {
  return (PLUGIN_OP_NAMES as readonly string[]).includes(value);
}

/** Inputs to {@link runPluginInvoke}: which plugin and Op to exercise plus the env/stdin context dv would supply. */
export interface RunPluginInvokeOptions {
  /** Plugin positional from the CLI (path or configured plugin reference). */
  pluginPositional: string;
  /** Op to invoke on the resolved plugin. */
  opName: PluginOpName;
  /** Package name to pass as Op context (sets `DV_PACKAGE_NAME`). */
  packageName?: string;
  /** Package directory to pass as Op context (sets `DV_PACKAGE_PATH`). */
  packagePath?: string;
  /** Repo root to pass as Op context (sets `DV_REPO_ROOT`). */
  repoRoot?: string;
  /** Discovery glob to pass to a `discover` Op. */
  discoverGlob?: string;
  /** New Version string for a `write-version` Op (sets `DV_NEW_VERSION`). */
  newVersion?: string;
  /** Git Tag to pass as Op context (sets `DV_GIT_TAG`). */
  gitTag?: string;
  /**
   * finalize-only inputs: `--trigger` flips `DV_FINALIZE_TRIGGER`
   * (`"version"` or `"v1"`); `--bumped-packages` is the literal JSON
   * payload dv would have built from the run's Plan. For an
   * ad-hoc debug invocation, the user may pass any well-formed
   * value (e.g. `[]` to simulate "nothing bumped").
   */
  finalizeTrigger?: "version" | "v1";
  /** Literal JSON payload for `finalize`'s bumped-Packages input. */
  bumpedPackagesJson?: string;
  /** Raw JSON to feed the plugin on stdin, overriding the default payload. */
  stdinJson?: string;
  /** Per-invocation timeout in milliseconds. */
  timeoutMs?: number;
  /** Emit the machine-readable `--json` result instead of human output. */
  emitJson: boolean;
  /** Whether ANSI color is enabled for human output. */
  colorEnabled: boolean;
  /** Emit `--debug` stdio tracing to stderr. */
  debug?: boolean;
}

/** Outcome of {@link runPluginInvoke}: the resolved plugin, the full stdio exchange, and the conformance verdict. */
export interface RunPluginInvokeResult {
  /** Absolute path the plugin reference resolved to. */
  resolvedPluginPath: string;
  /** Op that was invoked. */
  opName: PluginOpName;
  /** Environment variables passed to the plugin process. */
  environmentVariables: Record<string, string>;
  /** Payload written to the plugin's stdin, or `undefined` if none. */
  stdinPayload: string | undefined;
  /** Raw stdout captured from the plugin. */
  rawStdout: string;
  /** Raw stderr captured from the plugin. */
  rawStderr: string;
  /** Plugin response parsed from stdout against the per-Op Zod schema. */
  parsedResponse: unknown;
  /** Whether the response conformed to the per-Op response schema. */
  conformant: boolean;
}

/** Run a single plugin Op via JSON-over-stdio and return the full exchange and conformance verdict. */
export async function runPluginInvoke(
  options: RunPluginInvokeOptions,
): Promise<RunPluginInvokeResult> {
  const pluginReference = parsePluginPositional({
    rawPositional: options.pluginPositional,
  });
  const repoRootPath = options.repoRoot ?? Deno.cwd();
  const resolvedPlugin = await resolvePlugin({
    pluginReference,
    repoRootPath,
  });

  const environmentVariables = buildInvokeEnvironment({
    repoRootPath,
    opName: options.opName,
    packageName: options.packageName,
    packagePath: options.packagePath,
    discoverGlob: options.discoverGlob,
    newVersion: options.newVersion,
    gitTag: options.gitTag,
    finalizeTrigger: options.finalizeTrigger,
    bumpedPackagesJson: options.bumpedPackagesJson,
  });

  const stdinPayload = resolveStdinPayload({
    opName: options.opName,
    stdinJson: options.stdinJson,
  });

  if (!options.emitJson) {
    renderExchangeHeader({
      pluginPath: resolvedPlugin.path,
      opName: options.opName,
      environmentVariables,
      stdinPayload,
      colorEnabled: options.colorEnabled,
    });
  }

  // `dv plugin invoke` already prints the exchange itself; the
  // tool-wide `--debug` reporter adds a second, deeper view (full
  // exec line, exit code, duration) for plugin authors who want to
  // see what the runner observed.
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;
  const invocation = await invokeOp({
    resolvedPlugin,
    opName: options.opName,
    environmentVariables,
    stdinPayload,
    timeoutMs: options.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS,
    tracingHooks,
  });

  const parsedResponse = conformanceCheck({
    opName: options.opName,
    rawStdout: invocation.rawStdout,
    pluginPath: resolvedPlugin.path,
  });

  if (options.emitJson) {
    console.log(
      JSON.stringify(
        {
          schema: SCHEMA_URNS.pluginInvokeResult,
          pluginPath: resolvedPlugin.path,
          opName: options.opName,
          environmentVariables,
          stdinPayload: stdinPayload ?? null,
          rawStdout: invocation.rawStdout,
          rawStderr: invocation.rawStderr,
          parsedResponse,
          conformant: true,
        },
        null,
        2,
      ),
    );
  } else {
    renderExchangeResult({
      rawStdout: invocation.rawStdout,
      rawStderr: invocation.rawStderr,
      opName: options.opName,
      parsedResponse,
      colorEnabled: options.colorEnabled,
    });
  }

  return {
    resolvedPluginPath: resolvedPlugin.path,
    opName: options.opName,
    environmentVariables,
    stdinPayload,
    rawStdout: invocation.rawStdout,
    rawStderr: invocation.rawStderr,
    parsedResponse,
    conformant: true,
  };
}

interface BuildInvokeEnvironmentArgs {
  repoRootPath: string;
  opName: PluginOpName;
  packageName?: string;
  packagePath?: string;
  discoverGlob?: string;
  newVersion?: string;
  gitTag?: string;
  finalizeTrigger?: "version" | "v1";
  bumpedPackagesJson?: string;
}

function buildInvokeEnvironment(
  args: BuildInvokeEnvironmentArgs,
): Record<string, string> {
  const childEnvironment: Record<string, string> = {
    DV_REPO_ROOT: args.repoRootPath,
    PATH: Deno.env.get("PATH") ?? "",
  };
  const homeDirectory = Deno.env.get("HOME");
  if (homeDirectory) childEnvironment.HOME = homeDirectory;

  // Per-Op env requirements per specs/plugin-contract.md. The
  // command validates that the user supplied what the contract
  // requires so a missing flag produces a clear DvError, not a
  // runtime plugin failure with no context.

  // info is the metadata op — no per-package context needed.
  // dv passes DV_CONTRACT_VERSION so the plugin can self-validate
  // before responding; we leave that to invokeInfo in real runs,
  // but mirror the env shape here so debug-invocations look right.
  if (args.opName === "info") {
    childEnvironment.DV_CONTRACT_VERSION = DV_CONTRACT_VERSION;
    return childEnvironment;
  }

  if (args.opName === "discover") {
    if (args.discoverGlob === undefined) {
      throw missingFlagError({
        opName: args.opName,
        flag: "--glob",
        envVar: "DV_DISCOVER_GLOB",
      });
    }
    childEnvironment.DV_DISCOVER_GLOB = args.discoverGlob;
    return childEnvironment;
  }

  // finalize is per-plugin, not per-package — it sees DV_REPO_ROOT
  // (already set), DV_FINALIZE_TRIGGER, and DV_BUMPED_PACKAGES.
  // No DV_PACKAGE_NAME / DV_PACKAGE_PATH here; the bumped-packages
  // payload supplies that information for every package the
  // plugin governs that bumped this run.
  if (args.opName === "finalize") {
    childEnvironment.DV_FINALIZE_TRIGGER = args.finalizeTrigger ?? "version";
    childEnvironment.DV_BUMPED_PACKAGES = args.bumpedPackagesJson ?? "[]";
    return childEnvironment;
  }

  // Every other non-discover op requires DV_PACKAGE_NAME + DV_PACKAGE_PATH.
  if (args.packageName === undefined) {
    throw missingFlagError({
      opName: args.opName,
      flag: "--package",
      envVar: "DV_PACKAGE_NAME",
    });
  }
  if (args.packagePath === undefined) {
    throw missingFlagError({
      opName: args.opName,
      flag: "--path",
      envVar: "DV_PACKAGE_PATH",
    });
  }
  childEnvironment.DV_PACKAGE_NAME = args.packageName;
  childEnvironment.DV_PACKAGE_PATH = args.packagePath;

  if (args.opName === "write-version" || args.opName === "release") {
    if (args.newVersion === undefined) {
      throw missingFlagError({
        opName: args.opName,
        flag: "--new-version",
        envVar: "DV_NEW_VERSION",
      });
    }
    childEnvironment.DV_NEW_VERSION = args.newVersion;
  }

  if (args.opName === "release") {
    if (args.gitTag === undefined) {
      throw missingFlagError({
        opName: args.opName,
        flag: "--git-tag",
        envVar: "DV_GIT_TAG",
      });
    }
    childEnvironment.DV_GIT_TAG = args.gitTag;
  }

  return childEnvironment;
}

interface MissingFlagErrorArgs {
  opName: PluginOpName;
  flag: string;
  envVar: string;
}

function missingFlagError(args: MissingFlagErrorArgs): DvError {
  return new DvError({
    code: "plugin-bad-response",
    message: `${args.opName} requires ${args.flag} (sets ${args.envVar})`,
    hint: `pass \`${args.flag} <value>\` so dv can populate ${args.envVar} the way the real pipeline would`,
    context: { pluginPath: "<pre-invocation>", opName: args.opName },
  });
}

interface ResolveStdinPayloadArgs {
  opName: PluginOpName;
  stdinJson: string | undefined;
}

function resolveStdinPayload(
  args: ResolveStdinPayloadArgs,
): string | undefined {
  // update-dependency and get-dependencies are the Ops the contract
  // requires stdin for; release and the others read env vars only.
  // If the user passes --stdin-json for a no-stdin Op we still
  // honor it (debugging experimental plugins), but for these two
  // we enforce it.
  if (args.opName === "update-dependency" && args.stdinJson === undefined) {
    throw new DvError({
      code: "plugin-bad-response",
      message: "update-dependency requires --stdin-json '<payload>'",
      hint: 'supply the stdin JSON payload, e.g. `--stdin-json \'{"package":"cli","package_path":"packages/cli","dependency":"core","new_version":"1.3.0"}\'`',
      context: { pluginPath: "<pre-invocation>", opName: "update-dependency" },
    });
  }
  if (args.opName === "get-dependencies" && args.stdinJson === undefined) {
    throw new DvError({
      code: "plugin-bad-response",
      message: "get-dependencies requires --stdin-json '<payload>'",
      hint: 'supply the stdin JSON payload, e.g. `--stdin-json \'{"candidates":["@dv-cli/clipc","other"]}\'`',
      context: { pluginPath: "<pre-invocation>", opName: "get-dependencies" },
    });
  }
  if (args.stdinJson === undefined) return undefined;
  // Validate it's parseable JSON so the user finds out here rather
  // than after the plugin chokes on bad input.
  try {
    JSON.parse(args.stdinJson);
  } catch (caughtError) {
    const parserMessage =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    throw new DvError({
      code: "plugin-bad-response",
      message: `--stdin-json payload is not valid JSON: ${parserMessage}`,
      hint: "quote the payload with single quotes so the shell doesn't eat the braces",
      context: { pluginPath: "<pre-invocation>", opName: args.opName },
      cause: caughtError,
    });
  }
  return args.stdinJson;
}

interface ConformanceCheckArgs {
  opName: PluginOpName;
  rawStdout: string;
  pluginPath: string;
}

function conformanceCheck(args: ConformanceCheckArgs): unknown {
  switch (args.opName) {
    case "info":
      return parseInfoResponse({
        rawStdout: args.rawStdout,
        pluginPath: args.pluginPath,
      });
    case "discover":
      return parseDiscoverResponse({
        rawStdout: args.rawStdout,
        pluginPath: args.pluginPath,
      });
    case "read-version":
      return parseReadVersionResponse({
        rawStdout: args.rawStdout,
        pluginPath: args.pluginPath,
      });
    case "write-version":
      return parseWriteVersionResponse({
        rawStdout: args.rawStdout,
        pluginPath: args.pluginPath,
      });
    case "update-dependency":
      return parseUpdateDependencyResponse({
        rawStdout: args.rawStdout,
        pluginPath: args.pluginPath,
      });
    case "get-dependencies":
      return parseGetDependenciesResponse({
        rawStdout: args.rawStdout,
        pluginPath: args.pluginPath,
      });
    case "release":
      return parseReleaseResponse({
        rawStdout: args.rawStdout,
        pluginPath: args.pluginPath,
      });
    case "finalize":
      return parseFinalizeResponse({
        rawStdout: args.rawStdout,
        pluginPath: args.pluginPath,
      });
  }
}

interface RenderExchangeHeaderArgs {
  pluginPath: string;
  opName: PluginOpName;
  environmentVariables: Record<string, string>;
  stdinPayload: string | undefined;
  colorEnabled: boolean;
}

function renderExchangeHeader(args: RenderExchangeHeaderArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  console.log(
    `${styler.bold("→")} plugin ${styler.cyan(args.pluginPath)}  op ${styler.magenta(args.opName)}`,
  );
  // Only the DV_* vars matter for debugging — PATH/HOME are
  // forwarded mechanically and would clutter the output.
  const interestingEntries = Object.entries(args.environmentVariables)
    .filter(([key]) => key.startsWith("DV_"))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  for (const [key, value] of interestingEntries) {
    console.log(`    ${styler.dim(key)}=${value}`);
  }
  if (args.stdinPayload !== undefined) {
    console.log(`    ${styler.dim("stdin")}: ${args.stdinPayload}`);
  }
}

interface RenderExchangeResultArgs {
  rawStdout: string;
  rawStderr: string;
  opName: PluginOpName;
  parsedResponse: unknown;
  colorEnabled: boolean;
}

function renderExchangeResult(args: RenderExchangeResultArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  console.log(`${styler.bold("←")} stdout: ${args.rawStdout.trim()}   exit: 0`);
  const trimmedStderr = args.rawStderr.trim();
  if (trimmedStderr.length > 0) {
    console.log(`    ${styler.dim("stderr")}: ${trimmedStderr}`);
  }
  console.log(
    `${styler.green(styler.bold("✓"))} valid ${args.opName} response ${styler.dim(
      summarizeResponse(args.opName, args.parsedResponse),
    )}`,
  );
  console.log("");
}

function summarizeResponse(opName: PluginOpName, parsed: unknown): string {
  // Match the spec's tagline shape (e.g. "(version=1.2.3)") so users
  // can grep the example output line back from a real run.
  if (parsed === null || typeof parsed !== "object") return "";
  const responseRecord = parsed as Record<string, unknown>;
  switch (opName) {
    case "info": {
      const ops = Array.isArray(responseRecord.supportedOps)
        ? responseRecord.supportedOps
        : [];
      return `(contractVersion=${String(responseRecord.contractVersion)}, ${ops.length} ops)`;
    }
    case "discover": {
      const packages = responseRecord.packages;
      const count = Array.isArray(packages) ? packages.length : 0;
      return `(${count} package${count === 1 ? "" : "s"})`;
    }
    case "read-version":
      return `(version=${String(responseRecord.version)})`;
    case "write-version":
      return "(ok=true)";
    case "update-dependency":
      return `(changed=${String(responseRecord.changed)})`;
    case "get-dependencies": {
      const deps = responseRecord.dependencies;
      const count = Array.isArray(deps) ? deps.length : 0;
      return `(${count} dependenc${count === 1 ? "y" : "ies"})`;
    }
    case "release": {
      const ok = String(responseRecord.ok);
      const published =
        responseRecord.published === undefined
          ? ""
          : ` published=${String(responseRecord.published)}`;
      return `(ok=${ok}${published})`;
    }
    case "finalize": {
      if (responseRecord.unsupported === true) return "(unsupported)";
      const additionalChangedFiles = responseRecord.additionalChangedFiles;
      const count = Array.isArray(additionalChangedFiles)
        ? additionalChangedFiles.length
        : 0;
      return `(${count} file${count === 1 ? "" : "s"} changed)`;
    }
  }
}
