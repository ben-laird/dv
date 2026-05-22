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

// Recursive payload type — needs an explicit annotation so TS can close
// the loop on `z.lazy(...)`. Mirrors `CliErrorPayload` from errors.ts.
export interface RawCliErrorPayload {
  code: string;
  message: string;
  hint?: string;
  severity?: "error" | "warning";
  context?: Record<string, unknown>;
  subErrors?: RawCliErrorPayload[];
}

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

export const rawCliErrorEnvelopeSchema = z
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
      "The JSON shape emitted on stderr when a `@seshat/cli`-based CLI exits with an error under `--json` mode. The top-level `schema` field carries the URN so downstream tools (shell scripts, agent fleets) can version-gate before parsing.",
  });

export type RawCliErrorEnvelope = z.infer<typeof rawCliErrorEnvelopeSchema>;
