// Runs the apply-then-verify gate during in-flight work. Five
// stages (fmt → lint:fix → check → test → schemas:check) execute
// sequentially as subprocesses; output is buffered per stage and
// shown only on failure. The status line gives progress feedback.
//
// vs `deno task verify` (the read-only CI gate): `gate` applies
// auto-fixes (fmt rewrites, organize-imports) before running
// verification. Useful when iterating because alphabetical-sort
// warnings and trailing-whitespace formatting shouldn't make
// the inner loop chase its own tail.
//
// Run via `deno task gate`. Exits non-zero on the first stage that
// fails.

interface GateStage {
  label: string;
  taskName: string;
}

const GATE_STAGES: GateStage[] = [
  { label: "fmt", taskName: "fmt" },
  { label: "lint:fix", taskName: "lint:fix" },
  { label: "check", taskName: "check" },
  { label: "test", taskName: "test" },
  { label: "schemas:check", taskName: "schemas:check" },
];

interface StageResult {
  stage: GateStage;
  ok: boolean;
  durationMs: number;
  capturedStdout: string;
  capturedStderr: string;
}

async function runStage(stage: GateStage): Promise<StageResult> {
  const startedAt = performance.now();
  Deno.stderr.writeSync(
    new TextEncoder().encode(`▸ ${stage.label.padEnd(14)} `),
  );
  const subprocessResult = await new Deno.Command("deno", {
    args: ["task", stage.taskName],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const durationMs = performance.now() - startedAt;
  const capturedStdout = new TextDecoder().decode(subprocessResult.stdout);
  const capturedStderr = new TextDecoder().decode(subprocessResult.stderr);
  const statusLabel = subprocessResult.success
    ? `ok    (${formatDuration(durationMs)})`
    : `FAILED (${formatDuration(durationMs)})`;
  Deno.stderr.writeSync(new TextEncoder().encode(`${statusLabel}\n`));
  return {
    stage,
    ok: subprocessResult.success,
    durationMs,
    capturedStdout,
    capturedStderr,
  };
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

async function main(): Promise<number> {
  const startedAt = performance.now();
  let stagesRun = 0;
  for (const stage of GATE_STAGES) {
    const stageResult = await runStage(stage);
    stagesRun += 1;
    if (!stageResult.ok) {
      // On failure: dump the stage's captured output so the user
      // sees what went wrong without re-running the stage by hand.
      console.error("");
      console.error(`--- ${stage.label} stdout ---`);
      console.error(stageResult.capturedStdout || "(empty)");
      console.error(`--- ${stage.label} stderr ---`);
      console.error(stageResult.capturedStderr || "(empty)");
      console.error("");
      console.error(
        `gate failed at stage '${stage.label}' (${stagesRun}/${GATE_STAGES.length} run, ${formatDuration(performance.now() - startedAt)} total)`,
      );
      return 1;
    }
  }
  console.error(
    `gate passed (${GATE_STAGES.length}/${GATE_STAGES.length}, ${formatDuration(performance.now() - startedAt)})`,
  );
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
