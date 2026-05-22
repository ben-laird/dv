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
export {
  type BuildVersionPlanArgs,
  buildVersionPlan,
  type PackageCurrentVersionEntry,
} from "./plan.ts";
export {
  type Plan,
  type PlanAwaitingRelease,
  type PlanChangeCounts,
  type PlanPending,
  type PlanUnresolvedReference,
  parsedPlanSchema,
  type RawPlan,
  rawPlanSchema,
} from "./plan-schema.ts";
export { invokeReadVersion } from "./read-version.ts";
export { invokeWriteVersion } from "./write-version.ts";
