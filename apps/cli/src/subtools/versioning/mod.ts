// Public surface of the versioning Subtool: the pure algebra
// (classify, applyBump, joinBumps, aggregateBumps), the Plan builder,
// and the per-Package plugin Op invokers (read-version, write-version).
// `dv status` and `dv version` are orchestrations over these pieces;
// neither command's file holds domain logic of its own.

export type {
  AggregatedPackageBump,
  AggregateResult,
  ChangeCounts,
  UnresolvedReference,
} from "./aggregate.ts";
export { aggregateBumps } from "./aggregate.ts";
export { applyBump } from "./apply.ts";
export { joinBumps } from "./bump-join.ts";
export { classify } from "./classify.ts";
export { renderCommitMessage } from "./commit-message.ts";
export {
  type ComputeDependencyEdgesArgs,
  computeDependencyEdges,
  type DependencyEdges,
} from "./dependency-edges.ts";
export {
  type InvokeFinalizeArgs,
  type InvokeFinalizeResult,
  invokeFinalize,
} from "./finalize.ts";
export {
  type AwaitingReleaseLookupEntry,
  type BuildVersionPlanArgs,
  buildVersionPlan,
  type PackageCurrentVersionEntry,
} from "./plan.ts";
export {
  type Plan,
  type PlanAwaitingRelease,
  type PlanChangeCounts,
  type PlanPending,
  type PlanTracked,
  type PlanUnresolvedReference,
  parsedPlanSchema,
  type RawPlan,
  rawPlanSchema,
} from "./plan-schema.ts";
export { invokeReadVersion } from "./read-version.ts";
export {
  type InvokeUpdateDependencyArgs,
  type InvokeUpdateDependencyResult,
  invokeUpdateDependency,
} from "./update-dependency.ts";
export { invokeWriteVersion } from "./write-version.ts";
