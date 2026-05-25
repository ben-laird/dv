import { DvError } from "../../domain/errors.ts";
import type { ResolvedPlugin } from "../discovery/resolve.ts";
import {
  DV_CONTRACT_VERSION,
  type InfoResponse,
  parseInfoResponse,
} from "./response.ts";
import { invokeOp } from "./runner.ts";
import type { TracingHooks } from "./tracing.ts";

// Invokes the mandatory `info` plugin Op. dv calls this exactly
// once per plugin per run (via PluginInfoCache) before invoking
// any other op. The response tells dv:
//
//   1. Which contract version the plugin speaks
//      (refuse on mismatch — a v2 plugin in a v1 dv would
//      silently produce wrong shapes elsewhere)
//   2. Which ops the plugin actually implements
//      (so dv skips finalize / update-dependency / release
//      when the plugin hasn't opted in)
//
// `discover` is required to appear in supportedOps — a plugin
// that doesn't discover anything is useless. Everything else is
// optional. We assert this at the dv side rather than the schema
// side because the schema can't express "must contain literal
// 'discover'" cleanly across versions.

const DEFAULT_INFO_TIMEOUT_MS = 30_000;

export interface InvokeInfoArgs {
  resolvedPlugin: ResolvedPlugin;
  timeoutMs?: number;
  tracingHooks?: TracingHooks;
}

export async function invokeInfo(args: InvokeInfoArgs): Promise<InfoResponse> {
  const { resolvedPlugin } = args;
  const { rawStdout } = await invokeOp({
    resolvedPlugin,
    opName: "info",
    environmentVariables: buildInfoEnvironment(),
    timeoutMs: args.timeoutMs ?? DEFAULT_INFO_TIMEOUT_MS,
    tracingHooks: args.tracingHooks,
  });
  const validatedResponse = parseInfoResponse({
    rawStdout,
    pluginPath: resolvedPlugin.path,
  });
  assertContractCompatible({
    response: validatedResponse,
    pluginPath: resolvedPlugin.path,
  });
  assertDiscoverDeclared({
    response: validatedResponse,
    pluginPath: resolvedPlugin.path,
  });
  return validatedResponse;
}

function buildInfoEnvironment(): Record<string, string> {
  const childEnvironment: Record<string, string> = {
    PATH: Deno.env.get("PATH") ?? "",
  };
  const homeDirectory = Deno.env.get("HOME");
  if (homeDirectory) childEnvironment.HOME = homeDirectory;
  // dv tells the plugin which contract it expects so the plugin
  // can self-validate even before responding (a plugin written for
  // v2 could compare and short-circuit with a clean error).
  childEnvironment.DV_CONTRACT_VERSION = DV_CONTRACT_VERSION;
  return childEnvironment;
}

interface AssertContractCompatibleArgs {
  response: InfoResponse;
  pluginPath: string;
}

function assertContractCompatible(args: AssertContractCompatibleArgs): void {
  if (args.response.contractVersion === DV_CONTRACT_VERSION) return;
  throw new DvError({
    code: "plugin-contract-mismatch",
    message: `plugin reports contractVersion '${args.response.contractVersion}' but this dv speaks '${DV_CONTRACT_VERSION}'`,
    hint: "upgrade or downgrade the plugin to match this dv's contract version (see specs/plugin-contract.md)",
    context: {
      pluginPath: args.pluginPath,
      pluginContractVersion: args.response.contractVersion,
      expectedContractVersion: DV_CONTRACT_VERSION,
    },
  });
}

interface AssertDiscoverDeclaredArgs {
  response: InfoResponse;
  pluginPath: string;
}

function assertDiscoverDeclared(args: AssertDiscoverDeclaredArgs): void {
  if (args.response.supportedOps.includes("discover")) return;
  throw new DvError({
    code: "plugin-bad-response",
    message:
      "plugin's info.supportedOps does not include 'discover' — every plugin must implement discover",
    hint: "add 'discover' to your plugin's info.supportedOps and implement it per specs/plugin-contract.md",
    context: { pluginPath: args.pluginPath, opName: "info" },
  });
}

// Per-run cache. dv builds one of these once at the start of any
// command that touches plugins, then queries it before invoking
// any op. The contract-compatibility check above already happened
// when each entry was inserted, so consumers can trust the
// response — they only need to check `supportedOps`.

export class PluginInfoCache {
  // Keyed by the canonical pluginReferenceKey (e.g.
  // "path:./plugin", "run:deno run -A ./main.ts") since two
  // assignments referencing the same plugin must answer the same
  // info — there's no per-package config that would change it.
  private readonly cacheByKey = new Map<string, InfoResponse>();

  // Loads (or returns the cached) info for the given plugin.
  // `pluginKey` is the canonical key from pluginReferenceKey();
  // callers already compute it for the resolved-plugin map, so we
  // just take it directly rather than recompute.
  async getOrLoad(args: {
    pluginKey: string;
    resolvedPlugin: ResolvedPlugin;
    timeoutMs?: number;
    tracingHooks?: TracingHooks;
  }): Promise<InfoResponse> {
    const cached = this.cacheByKey.get(args.pluginKey);
    if (cached !== undefined) return cached;
    const fresh = await invokeInfo({
      resolvedPlugin: args.resolvedPlugin,
      timeoutMs: args.timeoutMs,
      tracingHooks: args.tracingHooks,
    });
    this.cacheByKey.set(args.pluginKey, fresh);
    return fresh;
  }

  // Read-only accessor for places that already loaded info
  // (typically right after resolveAllPlugins) and just need to
  // check an op. Returns undefined if the key wasn't preloaded —
  // callers should treat that as "load it now."
  get(pluginKey: string): InfoResponse | undefined {
    return this.cacheByKey.get(pluginKey);
  }
}
