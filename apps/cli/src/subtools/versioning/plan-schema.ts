import { z } from "zod";
import { SCHEMA_URNS } from "../../domain/schema-urns.ts";

// --- Public Plan contract (Zod-free) ---------------------------------------
// The Plan types are hand-written interfaces, not `z.infer` aliases, so the
// public surface never references Zod's internal types (`deno doc --lint`
// flags those as private-type-refs, and JSR's slow-types gate rejects the
// inferred shapes). The Zod schemas below are annotated `z.ZodType<…>`
// against these interfaces, so the two cannot drift: a schema that stops
// matching its interface fails to type-check.

/** Per-Change-Type tallies for a {@link PlanPending} entry of a {@link Plan}. */
export interface PlanChangeCounts {
  /** Number of `feat` Records feeding the bump. */
  feat: number;
  /** Number of `fix` Records feeding the bump. */
  fix: number;
  /** Count of breaking Records — `feat!` and `fix!` together. */
  breaking: number;
}

/**
 * A dependent Package whose constraint on a bumped Package would be rewritten
 * during the cascade. Part of a {@link PlanPending} entry of a {@link Plan}.
 */
export interface PlanConstraintUpdate {
  /** Name of the dependent Package whose manifest constraint changes. */
  dependent: string;
  /** The new version constraint dv would write for the bumped dependency. */
  newConstraint: string;
}

/** A {@link Plan} entry: a Package queued for a Bump on this run. */
export interface PlanPending {
  /** Name of the Package this bump applies to. */
  package: string;
  /** The Package's current Version, before the bump. */
  currentVersion: string;
  /** The Version dv would write after applying the aggregated Bump. */
  projectedVersion: string;
  /** The aggregated Bump across the feeding Records. */
  bump: "patch" | "minor" | "major";
  /** The Package's Stability — caps a pre-1.0 Package's Bump at minor. */
  stability: "Unstable" | "Stable";
  /** Per-Change-Type tally of the Records feeding this bump. */
  changeCounts: PlanChangeCounts;
  /** Record filenames feeding this bump, sorted lexicographically. */
  records: string[];
  /** Dependents whose constraint may be rewritten when this Package bumps. */
  constraintUpdates: PlanConstraintUpdate[];
}

/**
 * A {@link Plan} entry: a Package bumped but not yet tagged — its current
 * Version has no matching git Tag, so it awaits `dv release`.
 */
export interface PlanAwaitingRelease {
  /** Name of the Package awaiting a release tag. */
  package: string;
  /** The current (untagged) Version. */
  version: string;
  /** The Tag `dv release` would mint. */
  tag: string;
  /** True if this would be the Package's first `1.0.0` (a celebrated event). */
  firstStable: boolean;
  /**
   * The CHANGELOG release-notes body for this Version (heading dropped),
   * extracted from the Package's CHANGELOG.md so consumers (e.g. a GitHub
   * Release channel) don't re-parse the file. Empty string when no section
   * was found; never absent.
   */
  releaseNotes: string;
}

/**
 * A {@link Plan} entry: a Record pointing at a vanished Package with no
 * rename ledger entry. Halts `dv version` unless `--prune` drops it.
 */
export interface PlanUnresolvedReference {
  /** Filename of the Record carrying the reference. */
  record: string;
  /** The package name as written in the Record. */
  reference: string;
}

/**
 * A {@link Plan} entry: a discovered Package with its current Version,
 * independent of whether any Records are queued against it.
 */
export interface PlanTracked {
  /** Name of the discovered Package. */
  package: string;
  /** The Package's current Version, as the read-version Op reported it. */
  currentVersion: string;
  /** The Package's directory, relative to the repo root. */
  path: string;
}

/**
 * The side-effect-free structure emitted by `dv status --json` and
 * `dv version|release --dry-run --json`. A pure function of repo state —
 * the same plan-building code feeds the preview, the dry-run, and the real
 * run (specs/language.md Algebra §7; serializes to specs/schemas/plan.json).
 */
export interface Plan {
  /** Schema id — always `urn:dv:schema:v1:plan`. */
  schema: typeof SCHEMA_URNS.plan;
  /** Which command produced this Plan. */
  command: "status" | "version" | "release";
  /** Per-Package bumps that `dv version` would apply. */
  pending: PlanPending[];
  /** Packages whose current Version has no Tag (what `dv release` would tag). */
  awaitingRelease: PlanAwaitingRelease[];
  /** Records pointing at no current Package (halt `dv version` unless `--prune`). */
  unresolvedReferences: PlanUnresolvedReference[];
  /** Every Package discovery resolved, with its current Version. */
  tracked: PlanTracked[];
}

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

const semverStringSchema: z.ZodString = z
  .string()
  .regex(SEMVER_PATTERN, "must be SemVer (e.g. '1.4.2')");

const planBumpSchema: z.ZodEnum<{
  patch: "patch";
  minor: "minor";
  major: "major";
}> = z.enum(["patch", "minor", "major"]);

const planStabilitySchema: z.ZodEnum<{
  Unstable: "Unstable";
  Stable: "Stable";
}> = z.enum(["Unstable", "Stable"]);

const planChangeCountsSchema: z.ZodType<PlanChangeCounts> = z
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

const planConstraintUpdateSchema: z.ZodType<PlanConstraintUpdate> = z
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

const planPendingEntrySchema: z.ZodType<PlanPending> = z
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

const planAwaitingReleaseSchema: z.ZodType<PlanAwaitingRelease> = z
  .object({
    package: z.string(),
    version: semverStringSchema,
    tag: z.string().describe("The Tag that would be minted."),
    firstStable: z
      .boolean()
      .describe(
        "True if this would be the Package's first 1.0.0 (celebrated). False otherwise; never absent.",
      ),
    releaseNotes: z
      .string()
      .describe(
        "The CHANGELOG release-notes body for this Version (heading dropped), extracted from the Package's CHANGELOG.md. Empty string when no section was found; never absent.",
      ),
  })
  .strict()
  .meta({
    title: "Awaiting-release entry",
    description:
      "A Package whose current Version has no Tag — what `dv release` would tag, with its CHANGELOG release notes.",
  });

const planUnresolvedReferenceSchema: z.ZodType<PlanUnresolvedReference> = z
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

const planTrackedPackageSchema: z.ZodType<PlanTracked> = z
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

export const rawPlanSchema: z.ZodType<Plan> = z
  .object({
    schema: z.literal(SCHEMA_URNS.plan).describe("Schema id."),
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
    id: SCHEMA_URNS.plan,
    title: "dv Plan",
    description:
      "The side-effect-free Plan emitted by `dv status --json` and `dv version|release --dry-run --json`. A pure function of repo state (specs/language.md Algebra §7).",
  });

/**
 * Parser-shape mirrors the raw shape — the Plan is camelCased
 * throughout (it's produced by code, never authored by humans), so the
 * kebab→camel transform other schemas need is unnecessary here. The
 * split is preserved for symmetry with the rest of the codebase.
 */
export const parsedPlanSchema: z.ZodType<Plan> = rawPlanSchema;
