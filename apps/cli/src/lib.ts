/**
 * Public library surface of `@dv-cli/dv` — the programmatic way to drive
 * the tool in-process, without spawning a subprocess.
 *
 * Three usage levels, smallest to largest control:
 *
 * 1. **Binary boundary** — {@link main}. Takes a raw argv array and resolves
 *    to a process exit code, running the whole router (output-mode pre-scan,
 *    dispatch, error rendering). This is what the `dv` binary calls. Use it
 *    when you want the exact CLI behavior, exit code included.
 *
 *    ```ts
 *    import { main } from "@dv-cli/dv";
 *    const code = await main(["status", "--json"]);
 *    ```
 *
 * 2. **Command runners** — {@link runStatus}, {@link runVersion},
 *    {@link runRelease}, {@link runValidate}, {@link runV1}, {@link runInit},
 *    {@link runAdd}, {@link runRename}, {@link runMigrateConfig}, and the
 *    `runPlugin*` family. Each takes a typed options object and resolves to a
 *    typed result that carries the same data the `--json` contract serializes
 *    — e.g. `runStatus(...)` and `runVersion(...)` return a {@link Plan},
 *    `runRelease(...)` returns the release envelope ({@link RunReleaseResult}).
 *    Use these to bypass argv parsing and consume `dv`'s output as typed data.
 *
 *    ```ts
 *    import { runStatus, type Plan } from "@dv-cli/dv";
 *    const { plan } = await runStatus({ emitJson: false, colorEnabled: false });
 *    // `plan` is the typed Plan contract.
 *    ```
 *
 *    **Caveat:** the runners still write their human or `--json` render to
 *    stdout as a side effect (governed by `emitJson` / `colorEnabled`) — the
 *    typed return value is *in addition to*, not instead of, that output. A
 *    side-effect-free capturing entry point is deferred to a later release; if
 *    you need silent capture today, intercept `console.log` around the call
 *    (see `main.test.ts` for the pattern) or set `emitJson` and parse stdout.
 *
 * 3. **Contract types** — {@link Plan} and its members. The shape `dv status`,
 *    `dv version`, `dv v1`, and `dv release --json` serialize. Re-exported so
 *    consumers can type their own handling of the runner results.
 *
 * Consumers should import from this module (the package's `exports` entry),
 * not from `./cli/*.ts` or `./subtools/*.ts` directly — those paths aren't
 * part of the stable surface.
 *
 * @module
 */

// --- add -------------------------------------------------------------------
export {
  type RunAddOptions,
  type RunAddResult,
  runAdd,
} from "./cli/add.ts";
// --- init ------------------------------------------------------------------
export { type InitResult, runInit } from "./cli/init.ts";
// --- migrate config --------------------------------------------------------
export {
  type RunMigrateConfigOptions,
  type RunMigrateConfigResult,
  runMigrateConfig,
} from "./cli/migrate.ts";
export {
  PLUGIN_OP_NAMES,
  type PluginOpName,
  type RunPluginInvokeOptions,
  type RunPluginInvokeResult,
  runPluginInvoke,
} from "./cli/plugin-invoke.ts";
// --- plugin ----------------------------------------------------------------
export {
  type PluginListEntry,
  type PluginListEntryStatus,
  type RunPluginListOptions,
  type RunPluginListResult,
  runPluginList,
} from "./cli/plugin-list.ts";
export {
  type CheckOutcome,
  type CheckReport,
  type RunPluginVerifyOptions,
  type RunPluginVerifyResult,
  runPluginVerify,
} from "./cli/plugin-verify.ts";
// --- release ---------------------------------------------------------------
export {
  type ReleaseOpOutcome,
  type RunReleaseOptions,
  type RunReleaseResult,
  runRelease,
} from "./cli/release.ts";
// --- rename ----------------------------------------------------------------
export {
  type RunRenameOptions,
  type RunRenameResult,
  runRename,
} from "./cli/rename.ts";
// --- status ----------------------------------------------------------------
export {
  type RunStatusOptions,
  type RunStatusResult,
  runStatus,
} from "./cli/status.ts";
// --- v1 --------------------------------------------------------------------
export {
  type CascadedUpdate as V1CascadedUpdate,
  type FinalizedFile as V1FinalizedFile,
  type RunV1CatalogOptions,
  type RunV1CatalogResult,
  type RunV1Options,
  type RunV1Result,
  runV1,
  runV1Catalog,
} from "./cli/v1.ts";
// --- validate --------------------------------------------------------------
export {
  type RunValidateOptions,
  type RunValidateResult,
  runValidate,
  type ValidationProblem,
  type ValidationReport,
} from "./cli/validate.ts";
// --- version ---------------------------------------------------------------
// `CascadedUpdate` / `FinalizedFile` exist in both version.ts and v1.ts with
// the same shape; aliased per command so both are nameable from one barrel.
export {
  type CascadedUpdate,
  type FinalizedFile,
  type RunVersionOptions,
  type RunVersionResult,
  runVersion,
} from "./cli/version.ts";
// --- Domain types referenced by the runner options/results -----------------
// Reachable through the public option/result shapes above (e.g.
// `RunAddOptions.changeType` is a {@link ChangeType}), so they're part of the
// surface a consumer types against. Re-exported here so they can be imported
// by name rather than reached through an indexed access type.
export { CHANGE_TYPES, type ChangeType } from "./domain/change-type.ts";
export type { PluginAssignment, PluginReference } from "./domain/config.ts";
export type { Package } from "./domain/package.ts";
// --- Binary boundary -------------------------------------------------------
export { main } from "./main.ts";
export type {
  ConfigMigrationStepResult,
  MigrationChange,
} from "./subtools/config-migrations/mod.ts";
export type { ResolvedPlugin } from "./subtools/discovery/resolve.ts";
export type { SlugRandomSource } from "./subtools/records/mod.ts";
// --- Contract types (the `--json` shape) -----------------------------------
export type {
  Plan,
  PlanAwaitingRelease,
  PlanChangeCounts,
  PlanConstraintUpdate,
  PlanPending,
  PlanTracked,
  PlanUnresolvedReference,
} from "./subtools/versioning/mod.ts";
