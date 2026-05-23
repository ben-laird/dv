import type {
  ConfigMigrationStepApplyArgs,
  ConfigMigrationStepApplyResult,
} from "./step-types.ts";
import { useKeyStep } from "./step-use-key.ts";

// Ordered registry of config migration steps. The runner walks
// this list in order, piping each step's rewritten text into the
// next step's input — so the order matters when one step's
// rewrite produces shape another later step recognizes. Within a
// single dv release, steps are independent; the ordering becomes
// load-bearing only when future steps build on the output of
// prior ones.
//
// To add a new step:
//   1. Create `subtools/config-migrations/step-<short-name>.ts`
//      exporting a descriptor object matching the
//      ConfigMigrationStep interface below.
//   2. Append it to CONFIG_MIGRATION_STEPS here. Append, don't
//      insert — users with a config from an earlier dv release
//      still need every prior step to walk forward.
//   3. Add tests under `subtools/config-migrations/step-<name>.test.ts`.
//   4. Update specs/config-format.md § Migration with the
//      before/after for the new shape.

export interface ConfigMigrationStep {
  // Stable identifier, kebab-case. Used in --json output and in
  // human summaries so users can correlate a change to its step.
  id: string;
  // One-line human description, used by the CLI's summary.
  description: string;
  // Pure function: text in, text + change-list out. A step that
  // doesn't detect its legacy shape returns `changes: []` and the
  // text unchanged.
  apply(args: ConfigMigrationStepApplyArgs): ConfigMigrationStepApplyResult;
}

export const CONFIG_MIGRATION_STEPS: ConfigMigrationStep[] = [useKeyStep];
