import { z } from "zod";

// Zod source for the Plan emitted by `dv status --json` and
// `dv version --dry-run --json` (specs/language.md Algebra §7: plan is a
// pure function of repo state; the same builder runs in status, dry-run,
// and the real run).
//
// **Invariant:** as elsewhere in this codebase, the raw schema carries
// no `.transform()` calls — `z.toJSONSchema()` cannot represent them.
// The Plan is already camelCased internally so the parser-shape schema
// is just a re-export; the pair is kept for symmetry with config and
// records (.claude/CONVENTIONS.md § Schemas).

const SEMVER_PATTERN =
  /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const semverStringSchema = z
  .string()
  .regex(SEMVER_PATTERN, "must be SemVer (e.g. '1.4.2')");

const planBumpSchema = z.enum(["patch", "minor", "major"]);

const planStabilitySchema = z.enum(["Unstable", "Stable"]);

const planChangeCountsSchema = z
  .object({
    feat: z.int().nonnegative(),
    fix: z.int().nonnegative(),
    breaking: z.int().nonnegative(),
  })
  .strict()
  .meta({
    title: "Change counts",
    description:
      "Per-Package tally of the Records feeding the bump. `breaking` counts feat! and fix! together (independent of the Unstable cap).",
  });

const planConstraintUpdateSchema = z
  .object({
    dependent: z.string(),
    newConstraint: z.string(),
  })
  .strict()
  .meta({
    title: "Constraint update",
    description:
      "A dependent Package whose constraint on the bumped Package will be rewritten. When dv can resolve the dependency graph (the plugin implements `get-dependencies`) this lists only real dependents; for packages whose plugin lacks that op, dv falls back to listing them as candidates and the plugin filters at execute time via `changed: false`.",
  });

const planPendingEntrySchema = z
  .object({
    package: z.string(),
    currentVersion: semverStringSchema,
    projectedVersion: semverStringSchema,
    bump: planBumpSchema,
    stability: planStabilitySchema,
    changeCounts: planChangeCountsSchema,
    records: z
      .array(z.string())
      .describe(
        "Record filenames feeding this bump, sorted lexicographically.",
      ),
    constraintUpdates: z
      .array(planConstraintUpdateSchema)
      .describe(
        "Dependents whose constraint may be rewritten when this Package bumps. The plugin filters per-manifest at execute time.",
      ),
  })
  .strict()
  .meta({
    title: "Pending bump",
    description:
      "What `dv version` would do for one Package: the aggregated Bump, projected Version, change counts, and the Records feeding it.",
  });

const planAwaitingReleaseSchema = z
  .object({
    package: z.string(),
    version: semverStringSchema,
    tag: z.string().describe("The Tag that would be minted."),
    firstStable: z
      .boolean()
      .describe(
        "True if this would be the Package's first 1.0.0 (celebrated). False otherwise; never absent.",
      ),
  })
  .strict()
  .meta({
    title: "Awaiting-release entry",
    description:
      "A Package whose current Version has no Tag — what `dv release` would tag. Always empty in M3 — tag-state queries are M5.",
  });

const planUnresolvedReferenceSchema = z
  .object({
    record: z
      .string()
      .describe("Filename of the Record carrying the reference."),
    reference: z
      .string()
      .describe("The package name as written in the Record."),
  })
  .strict()
  .meta({
    title: "Unresolved Reference",
    description:
      "A Record references a Package that no discovery plugin claims and no rename ledger edge maps to. Halts `dv version` unless --prune.",
  });

const planTrackedPackageSchema = z
  .object({
    package: z.string(),
    currentVersion: semverStringSchema,
    path: z.string().describe("Directory relative to repo root."),
  })
  .strict()
  .meta({
    title: "Tracked package",
    description:
      "A Package discovery resolved and whose current Version the read-version Op returned. Lists every Package dv is aware of, regardless of whether any Records are pending against it.",
  });

export const rawPlanSchema = z
  .object({
    schema: z.literal("urn:dv:schema:v1:plan").describe("Schema id."),
    command: z
      .enum(["status", "version", "release"])
      .describe("Which command produced this Plan."),
    pending: z
      .array(planPendingEntrySchema)
      .describe("Per-Package bumps that `dv version` would apply."),
    awaitingRelease: z
      .array(planAwaitingReleaseSchema)
      .describe("Packages whose current Version has no Tag."),
    unresolvedReferences: z
      .array(planUnresolvedReferenceSchema)
      .describe(
        "Records pointing at no current Package (halt `dv version` unless --prune).",
      ),
    tracked: z
      .array(planTrackedPackageSchema)
      .describe(
        "Every Package discovery resolved, with its current Version. Independent of `pending` — populated even when no Records are queued.",
      ),
  })
  .strict()
  .meta({
    id: "urn:dv:schema:v1:plan",
    title: "dv Plan",
    description:
      "The side-effect-free Plan emitted by `dv status --json` and `dv version|release --dry-run --json`. A pure function of repo state (specs/language.md Algebra §7).",
  });

export type RawPlan = z.infer<typeof rawPlanSchema>;

// Parser-shape mirrors the raw shape — the Plan is camelCased
// throughout (it's produced by code, never authored by humans), so the
// kebab→camel transform other schemas need is unnecessary here. The
// split is preserved for symmetry with the rest of the codebase.

export const parsedPlanSchema = rawPlanSchema;

export type Plan = z.infer<typeof parsedPlanSchema>;
export type PlanPending = Plan["pending"][number];
export type PlanAwaitingRelease = Plan["awaitingRelease"][number];
export type PlanUnresolvedReference = Plan["unresolvedReferences"][number];
export type PlanChangeCounts = Plan["pending"][number]["changeCounts"];
export type PlanTracked = Plan["tracked"][number];
