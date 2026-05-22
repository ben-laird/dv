import type { Package } from "../domain/package.ts";

// The serializable Plan emitted by `dv status --json` and (in later
// milestones) `dv version|release --dry-run --json`. The shape matches
// specs/schemas/plan.json. Milestone 1 only fills in metadata; the
// substantive arrays are empty placeholders until later subtools land.

export interface PlanPending {
  package: string;
  currentVersion: string;
  projectedVersion: string;
  bump: "patch" | "minor" | "major";
}

export interface PlanAwaiting {
  package: string;
  version: string;
  tag: string;
}

export interface Plan {
  schema: "urn:dv:schema:v1:plan";
  command: "status" | "version" | "release";
  pending: PlanPending[];
  awaitingRelease: PlanAwaiting[];
}

interface RenderPlanJsonArgs {
  plan: Plan;
  discoveredPackages: Package[];
}

// Renders a Plan as deterministic JSON. Discovered Packages ride along as a
// transitional milestone-1 field so `--json` is usable today; the field will
// retire as soon as `pending` and `awaitingRelease` carry real data.
export function renderPlanJson(args: RenderPlanJsonArgs): string {
  const { plan, discoveredPackages } = args;
  const serializableObject: Record<string, unknown> = {
    schema: plan.schema,
    command: plan.command,
    pending: plan.pending,
    awaitingRelease: plan.awaitingRelease,
  };
  if (discoveredPackages.length > 0) {
    serializableObject.discovered = discoveredPackages.map(
      (discoveredPackage) => ({
        name: discoveredPackage.name,
        path: discoveredPackage.path,
        plugin: discoveredPackage.plugin,
      }),
    );
  }
  return JSON.stringify(serializableObject, null, 2);
}
