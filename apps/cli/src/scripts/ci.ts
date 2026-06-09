// The single source of truth for the validation gate set. Both
// `deno task verify` (local) and the `validate` GitHub workflow run THIS
// script, so the two can never drift — the bug that motivated it was a
// public-API change passing `deno task verify` locally while failing
// `doc:lint` in CI, because `verify` and the workflow were two
// hand-maintained lists of the same gates.
//
// Each gate is a subprocess; output is buffered and shown only on failure
// (a passing run stays quiet except for the progress line). Fail-fast:
// stops at the first failing gate, matching CI.
//
// Gates that exercise the CLI itself (`dv validate`, `dv plugin verify`)
// invoke `apps/cli/src/main.ts` directly rather than a PATH-installed
// shim, so a local run and a CI run execute byte-identical commands and
// CI needs no separate "install dv" step.
//
// Run via `deno task verify`. Add or remove a gate HERE and both local
// and CI pick it up.

import { dirname, fromFileUrl, resolve } from "@std/path";

// Repo root: this file is apps/cli/src/scripts/ci.ts → four levels up.
const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "../../../..");

const CLI_MAIN = resolve(REPO_ROOT, "apps/cli/src/main.ts");

interface Gate {
  /** Short label shown on the progress line and in the failure banner. */
  label: string;
  /** The executable to spawn (e.g. `deno`). */
  executable: string;
  /** Arguments passed to {@link Gate.executable}. */
  args: string[];
  /** Working directory relative to the repo root; defaults to the root. */
  cwd?: string;
}

// Spawns `dv <args>` against the in-tree CLI entry point (no PATH shim).
const dvGate = (label: string, ...dvArgs: string[]): Gate => ({
  label,
  executable: "deno",
  args: ["run", "-A", CLI_MAIN, ...dvArgs],
});

// Runs `deno task <name>` from the repo root.
const taskGate = (label: string, taskName: string): Gate => ({
  label,
  executable: "deno",
  args: ["task", taskName],
});

// The ordered gate set. Mirrors what a release depends on — change this
// list and nothing else. Code-quality gates first (cheapest feedback),
// then the dogfood gates that run the CLI against this repo, then the
// docs build.
const GATES: Gate[] = [
  // --- code-quality gates ---
  taskGate("fmt:check", "fmt:check"),
  taskGate("lint", "lint"),
  taskGate("check", "check"),
  taskGate("test", "test"),
  taskGate("schemas:check", "schemas:check"),
  // Publishability: the JSR slow-types check that fmt/lint/check/test miss.
  taskGate("publish:check", "publish:check"),
  // Doc-lint: JSDoc on the public surface + no private-type leaks. NOT part
  // of fmt/lint/check; a public-API change that trips it must fail here.
  taskGate("doc:lint", "doc:lint"),
  // --- dv-specific (dogfood) gates: run the CLI against this repo ---
  dvGate("dv validate", "validate", "--json"),
  dvGate(
    "dv plugin verify (deno example)",
    "plugin",
    "verify",
    "run:deno run -A ./examples/plugins/deno/main.ts",
  ),
  dvGate(
    "dv plugin verify (npm example)",
    "plugin",
    "verify",
    "run:deno run -A ./examples/plugins/npm/main.ts",
  ),
  dvGate(
    "dv plugin verify (tools/dv-release)",
    "plugin",
    "verify",
    "run:deno run -A ./tools/dv-release/main.ts",
  ),
  // --- docs site build: dead links + missing rewrites fail here ---
  {
    label: "docs build",
    executable: "deno",
    args: ["task", "build"],
    cwd: "apps/docs",
  },
];

interface GateResult {
  gate: Gate;
  ok: boolean;
  durationMs: number;
  capturedStdout: string;
  capturedStderr: string;
}

async function runGate(gate: Gate): Promise<GateResult> {
  const startedAt = performance.now();
  Deno.stderr.writeSync(
    new TextEncoder().encode(`▸ ${gate.label.padEnd(34)} `),
  );
  const subprocessResult = await new Deno.Command(gate.executable, {
    args: gate.args,
    cwd: gate.cwd ? resolve(REPO_ROOT, gate.cwd) : REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const durationMs = performance.now() - startedAt;
  const statusLabel = subprocessResult.success
    ? `ok     (${formatDuration(durationMs)})`
    : `FAILED (${formatDuration(durationMs)})`;
  Deno.stderr.writeSync(new TextEncoder().encode(`${statusLabel}\n`));
  return {
    gate,
    ok: subprocessResult.success,
    durationMs,
    capturedStdout: new TextDecoder().decode(subprocessResult.stdout),
    capturedStderr: new TextDecoder().decode(subprocessResult.stderr),
  };
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

async function main(): Promise<number> {
  const startedAt = performance.now();
  let gatesRun = 0;
  for (const gate of GATES) {
    const gateResult = await runGate(gate);
    gatesRun += 1;
    if (!gateResult.ok) {
      // Dump the failing gate's output so the failure is actionable
      // without re-running the gate by hand.
      console.error("");
      console.error(`--- ${gate.label} stdout ---`);
      console.error(gateResult.capturedStdout || "(empty)");
      console.error(`--- ${gate.label} stderr ---`);
      console.error(gateResult.capturedStderr || "(empty)");
      console.error("");
      console.error(
        `verify failed at gate '${gate.label}' (${gatesRun}/${GATES.length} run, ${formatDuration(performance.now() - startedAt)} total)`,
      );
      return 1;
    }
  }
  console.error(
    `verify passed (${GATES.length}/${GATES.length} gates, ${formatDuration(performance.now() - startedAt)})`,
  );
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
