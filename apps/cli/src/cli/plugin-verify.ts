import { DvError } from "../domain/errors.ts";
import { resolvePlugin } from "../subtools/discovery/resolve.ts";
import {
  invokeInfo,
  invokeOp,
  parseDiscoverResponse,
  parseFinalizeResponse,
  parseGetDependenciesResponse,
  parseReadVersionResponse,
  type TracingHooks,
} from "../subtools/plugin/mod.ts";
import { makeStderrTracingHooks } from "./debug-trace.ts";
import { parsePluginPositional } from "./parse-plugin-positional.ts";
import { makeStyler } from "./styler.ts";

// `dv plugin verify <plugin>` per specs/cli.md § dv plugin verify.
// Automated conformance smoke test for CI. The verifier:
//
//   1. invokes the mandatory `info` op (refuses on contract-version
//      mismatch; checks that discover is declared)
//   2. for each op the plugin declared in info.supportedOps:
//        - safe ops (discover, read-version, finalize) are
//          exercised end-to-end
//        - side-effectful ops (write-version, update-dependency,
//          release) report as `skipped` — there's no safe way to
//          auto-undo a manifest write or a publish, so verify
//          being honest about its scope beats pretending coverage
//   3. confirms a bogus op name exits non-zero (the contract
//      says bad input must fail loudly, not silently)
//
// Plugin authors can use `dv plugin invoke` to exercise the
// side-effectful ops against a throwaway fixture.

const DEFAULT_VERIFY_TIMEOUT_MS = 60_000;
const DEFAULT_VERIFY_GLOB = "*";
const BOGUS_OP_NAME = "__dv_plugin_verify_bogus__";

/** Inputs to {@link runPluginVerify}, mirroring `dv plugin verify`'s flags. */
export interface RunPluginVerifyOptions {
  /** Plugin positional: a name to resolve, or a path to the executable. */
  pluginPositional: string;
  /** Repo root the plugin resolves against; defaults to `Deno.cwd()`. */
  repoRoot?: string;
  /** Glob passed to the `discover` Op; defaults to `*`. */
  discoverGlob?: string;
  /** Per-Op timeout in milliseconds; defaults to 60s. */
  timeoutMs?: number;
  /** Emit machine-readable JSON instead of the human summary. */
  emitJson: boolean;
  /** Whether ANSI color is enabled for human output and trace lines. */
  colorEnabled: boolean;
  /** Trace each plugin invocation to stderr. */
  debug?: boolean;
}

/** Result of conformance-checking one Op against its schema. */
export type CheckOutcome = "pass" | "fail" | "skipped";

/** One Op's conformance check in the verify run. */
export interface CheckReport {
  /** Op name (or synthetic check, e.g. `info`, the bogus-op probe). */
  name: string;
  /** Whether the Op conformed, failed, or was skipped as side-effectful. */
  outcome: CheckOutcome;
  /** Human-readable explanation of the {@link outcome}. */
  detail: string;
}

/** Aggregate outcome of a `dv plugin verify` run. */
export interface RunPluginVerifyResult {
  /** Absolute path of the resolved plugin executable. */
  resolvedPluginPath: string;
  /** Per-Op {@link CheckReport} entries, in execution order. */
  checks: CheckReport[];
  /** Count of checks with a `pass` {@link CheckOutcome}. */
  passedCount: number;
  /** Count of checks with a `fail` {@link CheckOutcome}. */
  failedCount: number;
  /** Count of checks with a `skipped` {@link CheckOutcome}. */
  skippedCount: number;
}

/**
 * Conformance-check a plugin against the versioned per-Op schemas in
 * `specs/schemas/plugin-responses.json`. Backs `dv plugin verify`: invokes
 * `info`, exercises safe Ops end-to-end, skips side-effectful Ops, and
 * asserts a bogus Op name fails loudly. See {@link RunPluginVerifyOptions}.
 */
export async function runPluginVerify(
  options: RunPluginVerifyOptions,
): Promise<RunPluginVerifyResult> {
  const pluginReference = parsePluginPositional({
    rawPositional: options.pluginPositional,
  });
  const repoRootPath = options.repoRoot ?? Deno.cwd();
  const resolvedPlugin = await resolvePlugin({
    pluginReference,
    repoRootPath,
  });
  const opTimeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const discoverGlob = options.discoverGlob ?? DEFAULT_VERIFY_GLOB;
  const tracingHooks: TracingHooks | undefined = options.debug
    ? makeStderrTracingHooks({ colorEnabled: options.colorEnabled })
    : undefined;

  const checks: CheckReport[] = [];

  // ── info first: the mandatory op that tells us what to test ────
  // info also asserts the contract version matches and that
  // discover is declared — both via invokeInfo's internal checks.
  // We catch + report the failure as a verify result rather than
  // letting it throw, so the verify summary stays consistent
  // (every result is one check entry).
  let supportedOps: Set<string>;
  try {
    const infoResponse = await invokeInfo({
      resolvedPlugin,
      timeoutMs: opTimeoutMs,
      tracingHooks,
    });
    supportedOps = new Set(infoResponse.supportedOps);
    const nameSuffix =
      infoResponse.name !== undefined
        ? infoResponse.version !== undefined
          ? ` (${infoResponse.name} ${infoResponse.version})`
          : ` (${infoResponse.name})`
        : "";
    checks.push({
      name: "info",
      outcome: "pass",
      detail: `contractVersion=${infoResponse.contractVersion}, ${infoResponse.supportedOps.length} ops declared${nameSuffix}`,
    });
  } catch (caughtError) {
    // Without info we can't safely invoke anything else — the
    // contract requires it. Surface the failure and bail.
    checks.push({
      name: "info",
      outcome: "fail",
      detail: describeError(caughtError),
    });
    return finishVerify({
      checks,
      resolvedPluginPath: resolvedPlugin.path,
      emitJson: options.emitJson,
      colorEnabled: options.colorEnabled,
    });
  }

  // ── discover (only if declared) ─────────────────────────────────
  // info already asserts discover is declared, but this re-check
  // is defense-in-depth: any future relaxation of invokeInfo
  // wouldn't silently turn this skip into a pass.
  let discoveredPackages: { name: string; path: string }[] = [];
  if (supportedOps.has("discover")) {
    try {
      const discoverInvocation = await invokeOp({
        resolvedPlugin,
        opName: "discover",
        environmentVariables: buildVerifyEnvironment({
          repoRootPath,
          extra: { DV_DISCOVER_GLOB: discoverGlob },
        }),
        timeoutMs: opTimeoutMs,
        tracingHooks,
      });
      const discoverResponse = parseDiscoverResponse({
        rawStdout: discoverInvocation.rawStdout,
        pluginPath: resolvedPlugin.path,
      });
      discoveredPackages = discoverResponse.packages;
      checks.push({
        name: "discover",
        outcome: "pass",
        detail: `${discoveredPackages.length} package${
          discoveredPackages.length === 1 ? "" : "s"
        } returned for glob '${discoverGlob}'`,
      });
    } catch (caughtError) {
      checks.push({
        name: "discover",
        outcome: "fail",
        detail: describeError(caughtError),
      });
    }
  }

  // ── read-version per discovered package (only if declared) ──────
  if (supportedOps.has("read-version")) {
    if (discoveredPackages.length === 0) {
      checks.push({
        name: "read-version",
        outcome: "skipped",
        detail:
          "discover returned no packages — pass `--glob` so verify can exercise read-version against a real package",
      });
    } else {
      for (const discoveredPackage of discoveredPackages) {
        try {
          const readVersionInvocation = await invokeOp({
            resolvedPlugin,
            opName: "read-version",
            environmentVariables: buildVerifyEnvironment({
              repoRootPath,
              extra: {
                DV_PACKAGE_NAME: discoveredPackage.name,
                DV_PACKAGE_PATH: discoveredPackage.path,
              },
            }),
            timeoutMs: opTimeoutMs,
            tracingHooks,
          });
          const readVersionResponse = parseReadVersionResponse({
            rawStdout: readVersionInvocation.rawStdout,
            pluginPath: resolvedPlugin.path,
          });
          checks.push({
            name: `read-version[${discoveredPackage.name}]`,
            outcome: "pass",
            detail: `version=${readVersionResponse.version}`,
          });
        } catch (caughtError) {
          checks.push({
            name: `read-version[${discoveredPackage.name}]`,
            outcome: "fail",
            detail: describeError(caughtError),
          });
        }
      }
    }
  }

  // ── side-effectful ops: report as skipped (only if declared) ────
  // Undeclared side-effectful ops simply don't appear in the
  // summary — verify only reports on what the plugin says it
  // supports. Keeps the output focused on relevant checks.
  for (const sideEffectfulOp of [
    "write-version",
    "update-dependency",
    "release",
  ] as const) {
    if (!supportedOps.has(sideEffectfulOp)) continue;
    checks.push({
      name: sideEffectfulOp,
      outcome: "skipped",
      detail:
        "side-effectful — exercise with `dv plugin invoke` against a throwaway fixture",
    });
  }

  // ── finalize (only if declared) ─────────────────────────────────
  // Safe to verify with an empty bumped-packages list: the plugin
  // should be a no-op when nothing changed.
  if (supportedOps.has("finalize")) {
    try {
      const finalizeInvocation = await invokeOp({
        resolvedPlugin,
        opName: "finalize",
        environmentVariables: buildVerifyEnvironment({
          repoRootPath,
          extra: {
            DV_FINALIZE_TRIGGER: "version",
            DV_BUMPED_PACKAGES: "[]",
          },
        }),
        timeoutMs: opTimeoutMs,
        tracingHooks,
      });
      const finalizeResponse = parseFinalizeResponse({
        rawStdout: finalizeInvocation.rawStdout,
        pluginPath: resolvedPlugin.path,
      });
      if (finalizeResponse.ok) {
        const count = finalizeResponse.additionalChangedFiles?.length ?? 0;
        checks.push({
          name: "finalize",
          outcome: "pass",
          detail: `no-op run reported ${count} additional file${count === 1 ? "" : "s"}`,
        });
      } else {
        checks.push({
          name: "finalize",
          outcome: "fail",
          detail: `plugin returned ok:false (${finalizeResponse.message ?? "no message"})`,
        });
      }
    } catch (caughtError) {
      checks.push({
        name: "finalize",
        outcome: "fail",
        detail: describeError(caughtError),
      });
    }
  }

  // ── get-dependencies per discovered package (only if declared) ──
  // Read-only op (like read-version) so verify can safely exercise
  // it end-to-end. Empty `candidates` is a valid input (the plugin
  // should return `dependencies: []`) so we don't need a real
  // workspace.
  if (supportedOps.has("get-dependencies")) {
    if (discoveredPackages.length === 0) {
      checks.push({
        name: "get-dependencies",
        outcome: "skipped",
        detail:
          "discover returned no packages — pass `--glob` so verify can exercise get-dependencies against a real package",
      });
    } else {
      for (const discoveredPackage of discoveredPackages) {
        try {
          const getDependenciesInvocation = await invokeOp({
            resolvedPlugin,
            opName: "get-dependencies",
            environmentVariables: buildVerifyEnvironment({
              repoRootPath,
              extra: {
                DV_PACKAGE_NAME: discoveredPackage.name,
                DV_PACKAGE_PATH: discoveredPackage.path,
              },
            }),
            // Empty candidates → plugin should respond `{ok: true,
            // dependencies: []}`. Tests that the op runs cleanly
            // without testing any particular dep-graph shape.
            stdinPayload: JSON.stringify({ candidates: [] }),
            timeoutMs: opTimeoutMs,
            tracingHooks,
          });
          const getDependenciesResponse = parseGetDependenciesResponse({
            rawStdout: getDependenciesInvocation.rawStdout,
            pluginPath: resolvedPlugin.path,
          });
          // With empty candidates the plugin MUST return empty deps
          // (the response is a strict subset of candidates per the
          // contract). If it returns anything, that's a contract bug.
          if (getDependenciesResponse.dependencies.length === 0) {
            checks.push({
              name: `get-dependencies[${discoveredPackage.name}]`,
              outcome: "pass",
              detail: "empty-candidates probe returned an empty subset",
            });
          } else {
            checks.push({
              name: `get-dependencies[${discoveredPackage.name}]`,
              outcome: "fail",
              detail: `plugin returned dependencies for empty candidates: ${getDependenciesResponse.dependencies.join(", ")}`,
            });
          }
        } catch (caughtError) {
          checks.push({
            name: `get-dependencies[${discoveredPackage.name}]`,
            outcome: "fail",
            detail: describeError(caughtError),
          });
        }
      }
    }
  }

  // ── bad-input check: a bogus op name must exit non-zero ─────────
  try {
    await invokeOp({
      resolvedPlugin,
      opName: BOGUS_OP_NAME,
      environmentVariables: buildVerifyEnvironment({ repoRootPath }),
      timeoutMs: opTimeoutMs,
      tracingHooks,
    });
    // If we got here, the plugin returned exit 0 for a nonsense op
    // — that's a contract violation. The contract says bad input
    // produces a non-zero exit.
    checks.push({
      name: "bad-input rejects",
      outcome: "fail",
      detail: `plugin returned exit 0 for unknown op '${BOGUS_OP_NAME}' — contract requires non-zero exit on bad input`,
    });
  } catch (caughtError) {
    if (
      caughtError instanceof DvError &&
      (caughtError.kind.code === "plugin-exit-nonzero" ||
        caughtError.kind.code === "plugin-not-executable")
    ) {
      // Non-zero exit OR "no such op file" (directory-style
      // plugins) both satisfy the contract: bad input doesn't
      // silently succeed.
      checks.push({
        name: "bad-input rejects",
        outcome: "pass",
        detail:
          caughtError.kind.code === "plugin-exit-nonzero"
            ? `exited non-zero for unknown op '${BOGUS_OP_NAME}'`
            : `no executable for unknown op '${BOGUS_OP_NAME}' (directory plugin)`,
      });
    } else {
      checks.push({
        name: "bad-input rejects",
        outcome: "fail",
        detail: describeError(caughtError),
      });
    }
  }

  return finishVerify({
    checks,
    resolvedPluginPath: resolvedPlugin.path,
    emitJson: options.emitJson,
    colorEnabled: options.colorEnabled,
  });
}

interface FinishVerifyArgs {
  checks: CheckReport[];
  resolvedPluginPath: string;
  emitJson: boolean;
  colorEnabled: boolean;
}

function finishVerify(args: FinishVerifyArgs): RunPluginVerifyResult {
  const passedCount = args.checks.filter(
    (check) => check.outcome === "pass",
  ).length;
  const failedCount = args.checks.filter(
    (check) => check.outcome === "fail",
  ).length;
  const skippedCount = args.checks.filter(
    (check) => check.outcome === "skipped",
  ).length;

  if (args.emitJson) {
    console.log(
      JSON.stringify(
        {
          schema: "urn:dv:schema:v1:plugin-verify-result",
          pluginPath: args.resolvedPluginPath,
          checks: args.checks,
          summary: { passedCount, failedCount, skippedCount },
        },
        null,
        2,
      ),
    );
  } else {
    renderHumanSummary({
      pluginPath: args.resolvedPluginPath,
      checks: args.checks,
      passedCount,
      failedCount,
      skippedCount,
      colorEnabled: args.colorEnabled,
    });
  }

  return {
    resolvedPluginPath: args.resolvedPluginPath,
    checks: args.checks,
    passedCount,
    failedCount,
    skippedCount,
  };
}

interface BuildVerifyEnvironmentArgs {
  repoRootPath: string;
  extra?: Record<string, string>;
}

function buildVerifyEnvironment(
  args: BuildVerifyEnvironmentArgs,
): Record<string, string> {
  const childEnvironment: Record<string, string> = {
    DV_REPO_ROOT: args.repoRootPath,
    PATH: Deno.env.get("PATH") ?? "",
    ...(args.extra ?? {}),
  };
  const homeDirectory = Deno.env.get("HOME");
  if (homeDirectory) childEnvironment.HOME = homeDirectory;
  return childEnvironment;
}

function describeError(caughtError: unknown): string {
  if (caughtError instanceof DvError) {
    return `${caughtError.kind.code}: ${caughtError.message}`;
  }
  if (caughtError instanceof Error) return caughtError.message;
  return String(caughtError);
}

interface RenderHumanSummaryArgs {
  pluginPath: string;
  checks: CheckReport[];
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  colorEnabled: boolean;
}

function renderHumanSummary(args: RenderHumanSummaryArgs): void {
  const styler = makeStyler(args.colorEnabled);
  console.log("");
  console.log(`verifying plugin ${styler.cyan(args.pluginPath)}`);
  console.log("");
  for (const check of args.checks) {
    const marker =
      check.outcome === "pass"
        ? styler.green(styler.bold("✓"))
        : check.outcome === "fail"
          ? styler.red(styler.bold("✗"))
          : styler.dim("·");
    console.log(`  ${marker} ${check.name}  ${styler.dim(check.detail)}`);
  }
  console.log("");
  const verdict =
    args.failedCount === 0
      ? styler.green(styler.bold("PASS"))
      : styler.red(styler.bold("FAIL"));
  console.log(
    `${verdict}  ${args.passedCount} passed, ${args.failedCount} failed, ${args.skippedCount} skipped`,
  );
  console.log("");
}
