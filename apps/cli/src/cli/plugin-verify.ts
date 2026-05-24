import { DvError } from "../domain/errors.ts";
import { resolvePlugin } from "../subtools/discovery/resolve.ts";
import {
  invokeOp,
  parseDiscoverResponse,
  parseReadVersionResponse,
} from "../subtools/plugin/mod.ts";
import { parsePluginPositional } from "./parse-plugin-positional.ts";
import { makeStyler } from "./styler.ts";

// `dv plugin verify <plugin>` per specs/cli.md § dv plugin verify.
// Automated conformance smoke test for CI. The verifier exercises
// what's safely exerciseable without a real repo:
//
//   - resolve the plugin (catches not-found / not-executable)
//   - run `discover` against the glob and conformance-check the
//     response shape
//   - for each discovered package, run `read-version` (idempotent,
//     no side effects)
//   - run a deliberately-bogus op and confirm non-zero exit (the
//     contract says bad input must fail loudly, not silently)
//
// Side-effectful ops (write-version, update-dependency, release) are
// reported as `skipped` rather than executed — there's no way to
// auto-undo a manifest write or a publish, so verify being honest
// about its scope beats verify pretending it covered everything.
// Plugin authors can use `dv plugin invoke` to exercise those ops
// against a throwaway fixture.

const DEFAULT_VERIFY_TIMEOUT_MS = 60_000;
const DEFAULT_VERIFY_GLOB = "*";
const BOGUS_OP_NAME = "__dv_plugin_verify_bogus__";

export interface RunPluginVerifyOptions {
  pluginPositional: string;
  repoRoot?: string;
  discoverGlob?: string;
  timeoutMs?: number;
  emitJson: boolean;
  colorEnabled: boolean;
}

export type CheckOutcome = "pass" | "fail" | "skipped";

export interface CheckReport {
  name: string;
  outcome: CheckOutcome;
  detail: string;
}

export interface RunPluginVerifyResult {
  resolvedPluginPath: string;
  checks: CheckReport[];
  passedCount: number;
  failedCount: number;
  skippedCount: number;
}

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

  const checks: CheckReport[] = [];

  // ── discover ────────────────────────────────────────────────────
  let discoveredPackages: { name: string; path: string }[] = [];
  try {
    const discoverInvocation = await invokeOp({
      resolvedPlugin,
      opName: "discover",
      environmentVariables: buildVerifyEnvironment({
        repoRootPath,
        extra: { DV_DISCOVER_GLOB: discoverGlob },
      }),
      timeoutMs: opTimeoutMs,
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

  // ── read-version per discovered package ─────────────────────────
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

  // ── side-effectful ops: report as skipped ───────────────────────
  for (const sideEffectfulOp of [
    "write-version",
    "update-dependency",
    "release",
  ] as const) {
    checks.push({
      name: sideEffectfulOp,
      outcome: "skipped",
      detail:
        "side-effectful — exercise with `dv plugin invoke` against a throwaway fixture",
    });
  }

  // ── bad-input check: a bogus op name must exit non-zero ─────────
  try {
    await invokeOp({
      resolvedPlugin,
      opName: BOGUS_OP_NAME,
      environmentVariables: buildVerifyEnvironment({ repoRootPath }),
      timeoutMs: opTimeoutMs,
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

  const passedCount = checks.filter((check) => check.outcome === "pass").length;
  const failedCount = checks.filter((check) => check.outcome === "fail").length;
  const skippedCount = checks.filter(
    (check) => check.outcome === "skipped",
  ).length;

  if (options.emitJson) {
    console.log(
      JSON.stringify(
        {
          schema: "urn:dv:schema:v1:plugin-verify-result",
          pluginPath: resolvedPlugin.path,
          checks,
          summary: { passedCount, failedCount, skippedCount },
        },
        null,
        2,
      ),
    );
  } else {
    renderHumanSummary({
      pluginPath: resolvedPlugin.path,
      checks,
      passedCount,
      failedCount,
      skippedCount,
      colorEnabled: options.colorEnabled,
    });
  }

  return {
    resolvedPluginPath: resolvedPlugin.path,
    checks,
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
