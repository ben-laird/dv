import { DV_VERSION } from "../../dv-version.ts";
import { createSchemaPointerStep } from "./step-schema-pointer.ts";
import type { ConfigMigrationStep } from "./step-types.ts";
import { useKeyStep } from "./step-use-key.ts";

export type { ConfigMigrationStep } from "./step-types.ts";

// Ordered registry of config migration steps. The runner walks
// this list in order, piping each step's rewritten text into the
// next step's input — so the order matters when one step's
// rewrite produces shape another later step recognizes. Within a
// single dv release, steps are independent; the ordering becomes
// load-bearing only when future steps build on the output of
// prior ones.
//
// A step covers either a breaking config change (`use-key-discriminated`)
// or routine upkeep a config needs as dv moves on
// (`schema-pointer-current`). Both kinds must be idempotent.
//
// To add a new step:
//   1. Create `subtools/config-migrations/step-<short-name>.ts`
//      exporting a descriptor object matching the
//      ConfigMigrationStep interface (step-types.ts).
//   2. Append it to CONFIG_MIGRATION_STEPS here. Append, don't
//      insert — users with a config from an earlier dv release
//      still need every prior step to walk forward.
//   3. Add tests under `subtools/config-migrations/step-<name>.test.ts`.
//   4. Specify it in specs/cli.md § dv migrate config and in the
//      specs/config-format.md section for the field it rewrites.

export const CONFIG_MIGRATION_STEPS: ConfigMigrationStep[] = [
  useKeyStep,
  createSchemaPointerStep({ runningVersion: DV_VERSION }),
];
