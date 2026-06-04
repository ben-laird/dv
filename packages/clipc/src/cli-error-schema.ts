import { z } from "zod";

// Zod source for the JSON envelope CliError produces under --json mode.
// The wire shape matches `CliError.toJSON()` exactly: code/message/hint/
// severity/context flat at the top level, subErrors as a recursive
// array. Top-level `schema` field identifies the envelope so consumers
// (shell scripts, agents) can version-gate.
//
// **Invariant** (matches the rest of this repo's schemas): the raw shape
// carries no `.transform()` calls so `z.toJSONSchema()` can emit it
// faithfully. The recursion uses `z.lazy` rather than `z.recursive` —
// the latter is unrepresentable in JSON Schema.

const cliErrorSeveritySchema = z.enum(["error", "warning"]);

/**
 * One node in the JSON error tree emitted under `--json` mode. Mirrors
 * `CliErrorPayload` from `errors.ts` and the structure validated by
 * {@link rawCliErrorPayloadSchema}; recursive via `subErrors`. Declared
 * as an interface (rather than `z.infer`) so the schema below can carry
 * an explicit `z.ZodType<...>` annotation that closes the `z.lazy` loop.
 */
export interface RawCliErrorPayload {
  /** Stable error code (e.g. `"dirty-tree"`) that consumers branch on. */
  code: string;
  /** Human-readable summary of the failure. */
  message: string;
  /** Actionable next-step suggestion, when one applies. */
  hint?: string;
  /** Severity; omitted on the default (`"error"`), present only for warnings. */
  severity?: "error" | "warning";
  /** Per-code structured context whose shape varies by `code`. */
  context?: Record<string, unknown>;
  /** Child errors aggregated under this one (recursive). */
  subErrors?: RawCliErrorPayload[];
}

/**
 * Zod schema validating a single {@link RawCliErrorPayload} node. Carries
 * no `.transform()` calls so `z.toJSONSchema()` can emit it faithfully,
 * and uses `z.lazy` for the recursive `subErrors` array.
 */
export const rawCliErrorPayloadSchema: z.ZodType<RawCliErrorPayload> = z
  .object({
    code: z.string().describe("Stable error code (e.g. 'dirty-tree')."),
    message: z.string().describe("Human-readable summary."),
    hint: z
      .string()
      .optional()
      .describe("Actionable next-step suggestion, when one applies."),
    severity: cliErrorSeveritySchema
      .optional()
      .describe(
        "Omitted on the default ('error'); present only for warning-severity entries.",
      ),
    context: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Per-code structured context — shape varies by `code`. Consumers branch on `code` to read fields safely.",
      ),
    subErrors: z
      .array(z.lazy(() => rawCliErrorPayloadSchema))
      .optional()
      .describe(
        "Child errors aggregated under this one (e.g. per-package publish failures under release-partial-failure).",
      ),
  })
  .strict()
  .meta({
    title: "CLI error payload",
    description:
      "One node in the error tree. Recursive via `subErrors`. Wire shape is flat (code/context/etc. at the top level) — the `kind` nesting in the in-process class is a TS-narrowing convenience, not a wire concern.",
  });

/**
 * The top-level JSON envelope a `@dv-cli/clipc`-based CLI emits on stderr
 * under `--json` mode: a `schema` URN plus the root `error` tree. Matches
 * the wire shape of {@link rawCliErrorEnvelopeSchema}; declared as an
 * interface so that schema can carry an explicit `z.ZodType<...>`
 * annotation for JSR's fast-types check (Zod's inferred output type is
 * too opaque to use directly).
 */
export interface RawCliErrorEnvelope {
  /** Schema URN identifying the envelope version, for consumer version-gating. */
  schema: string;
  /** The root error tree carried by the envelope. */
  error: RawCliErrorPayload;
}

/**
 * Zod schema validating a {@link RawCliErrorEnvelope}. The top-level
 * `schema` URN lets downstream tools (shell scripts, agent fleets)
 * version-gate before parsing the recursive `error` tree.
 */
export const rawCliErrorEnvelopeSchema: z.ZodType<RawCliErrorEnvelope> = z
  .object({
    schema: z
      .string()
      .describe(
        "Schema URN identifying the envelope version. Consumers should match against this before reading the `error` tree.",
      ),
    error: rawCliErrorPayloadSchema,
  })
  .strict()
  .meta({
    title: "CLI error envelope",
    description:
      "The JSON shape emitted on stderr when a `@dv-cli/clipc`-based CLI exits with an error under `--json` mode. The top-level `schema` field carries the URN so downstream tools (shell scripts, agent fleets) can version-gate before parsing.",
  });
// `RawCliErrorEnvelope` is the public type users would import to type
// the envelope; declared as an interface above (rather than via
// `z.infer`) so the export carries an explicit signature for JSR's
// fast-types check.
