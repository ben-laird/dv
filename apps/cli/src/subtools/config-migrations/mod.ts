// Config migrations subtool. Each breaking shape change to
// `.dv/config.yaml` between dv versions ships with one migration
// step that recognizes the legacy shape and rewrites it in place.
// The runner composes all registered steps so a single
// `dv migrate config` invocation walks a config forward through
// every applicable step in order.
//
// Why this lives in its own subtool: the config schema *will*
// move again (v1 → v2, etc.). Each breaking change shoulders the
// obligation to ship a rewriter. Without a uniform shape for
// "given config in shape N, produce config in shape N+1", every
// new migration ends up bolted onto whatever existed before. The
// subtool gives migrations a home with a stable shape: one step
// per breaking change, registered in `steps.ts` in order, each
// independently testable.
//
// Text-in / text-out per step: comments and whitespace in the
// user's YAML are part of the value of the file (they explain
// *why* the config is shaped a certain way), and round-tripping
// through @std/yaml's parse + stringify would destroy them. Steps
// implement their rewrite as a text transform; the runner just
// chains them. Brittle to unusual formatting but precise about
// the common case (anything `dv init` produces or modest hand
// edits).

import type { MigrationChange } from "./step-types.ts";
import { CONFIG_MIGRATION_STEPS } from "./steps.ts";

export type { MigrationChange } from "./step-types.ts";
export type { ConfigMigrationStep } from "./steps.ts";

export interface RunConfigMigrationsArgs {
  // Raw YAML the user's config currently contains.
  originalText: string;
}

export interface RunConfigMigrationsResult {
  // Final text after all applicable steps have been applied. Equal
  // to `originalText` when no step matched (the all-migrated
  // case).
  rewrittenText: string;
  // Per-step records of what the step changed. Steps that didn't
  // match are omitted entirely — empty `changes` always means
  // "config is already in the current shape."
  stepResults: ConfigMigrationStepResult[];
}

/** One migration step's outcome. */
export interface ConfigMigrationStepResult {
  /** Stable identifier of the step that ran. */
  stepId: string;
  /** Human-readable description of what the step does. */
  description: string;
  /** The discrete changes the step made (see {@link MigrationChange}). */
  changes: MigrationChange[];
}

// Runs every registered migration step against `originalText` in
// order. Each step decides whether it applies (by detecting the
// legacy shape it knows about) and rewrites if so; the runner
// pipes each step's output into the next step's input. Idempotent
// by construction: a step that doesn't detect its legacy shape
// returns `changes: []` and the text unchanged, so repeatedly
// running migrations on an up-to-date config is a no-op.
export function runConfigMigrations(
  args: RunConfigMigrationsArgs,
): RunConfigMigrationsResult {
  let currentText = args.originalText;
  const stepResults: ConfigMigrationStepResult[] = [];
  for (const step of CONFIG_MIGRATION_STEPS) {
    const stepResult = step.apply({ text: currentText });
    if (stepResult.changes.length === 0) continue;
    currentText = stepResult.rewrittenText;
    stepResults.push({
      stepId: step.id,
      description: step.description,
      changes: stepResult.changes,
    });
  }
  return { rewrittenText: currentText, stepResults };
}

// Re-export the step registry for advanced consumers (tests, a
// future `--list` flag on dv migrate, doc generators). Callers
// that only want the runner shouldn't need to know steps exist.
export { CONFIG_MIGRATION_STEPS };
