import { z } from "zod";
import { DvError } from "../../domain/errors.ts";

// Zod schemas for plugin Op responses, per specs/schemas/plugin-responses.json.
// One schema per Op; the runner pipes raw stdout through the matching
// schema. The optional structured-error envelope (`{ ok: false, error: "..." }`)
// is recognized for any Op and turned into a PluginError.
//
// Per [[feedback-zod-for-contracts]], every plugin stdio boundary is
// validated through Zod, not hand-rolled. These schemas live in the
// shared plugin subtool because every subtool that talks to plugins
// (discovery, versioning, publishing) parses through them.

export const pluginErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
  })
  .strict();

const discoveredPackageSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

export const discoverResponseSchema = z
  .object({
    packages: z.array(discoveredPackageSchema),
  })
  .strict();

export type DiscoverResponse = z.infer<typeof discoverResponseSchema>;

// Standard SemVer pattern (matches specs/schemas/plugin-responses.json
// $defs.semver). Plugin authors get a precise schema-side failure
// message when they emit junk, not a downstream parseVersion crash.
const SEMVER_PATTERN =
  /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export const readVersionResponseSchema = z
  .object({
    version: z.string().regex(SEMVER_PATTERN, "must be SemVer (e.g. '1.4.2')"),
  })
  .strict();

export type ReadVersionResponse = z.infer<typeof readVersionResponseSchema>;

export const writeVersionResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export type WriteVersionResponse = z.infer<typeof writeVersionResponseSchema>;

export const updateDependencyResponseSchema = z
  .object({
    ok: z.literal(true),
    changed: z.boolean(),
  })
  .strict();

export type UpdateDependencyResponse = z.infer<
  typeof updateDependencyResponseSchema
>;

// `release` is the only Op where `{ok: false}` is a documented
// success path for the *protocol* — the plugin tells dv "this
// publish failed, but don't roll back the tag" (specs/plugin-
// contract.md: "Failures here do not roll back the tags").
// `published`, `skipped`, and `message` are optional; `ok` is the
// only required field. Less strict than write-version because
// publishing is intentionally fail-tolerant.
export const releaseResponseSchema = z
  .object({
    ok: z.boolean(),
    published: z.boolean().optional(),
    skipped: z.boolean().optional(),
    message: z.string().optional(),
  })
  .strict();

export type ReleaseResponse = z.infer<typeof releaseResponseSchema>;

interface ParseSingleOpResponseArgs {
  rawStdout: string;
  pluginPath: string;
}

export function parseDiscoverResponse(
  args: ParseSingleOpResponseArgs,
): DiscoverResponse {
  return parsePluginResponse({
    rawStdout: args.rawStdout,
    pluginPath: args.pluginPath,
    opName: "discover",
    responseSchema: discoverResponseSchema,
  });
}

export function parseReadVersionResponse(
  args: ParseSingleOpResponseArgs,
): ReadVersionResponse {
  return parsePluginResponse({
    rawStdout: args.rawStdout,
    pluginPath: args.pluginPath,
    opName: "read-version",
    responseSchema: readVersionResponseSchema,
  });
}

export function parseWriteVersionResponse(
  args: ParseSingleOpResponseArgs,
): WriteVersionResponse {
  return parsePluginResponse({
    rawStdout: args.rawStdout,
    pluginPath: args.pluginPath,
    opName: "write-version",
    responseSchema: writeVersionResponseSchema,
  });
}

export function parseUpdateDependencyResponse(
  args: ParseSingleOpResponseArgs,
): UpdateDependencyResponse {
  return parsePluginResponse({
    rawStdout: args.rawStdout,
    pluginPath: args.pluginPath,
    opName: "update-dependency",
    responseSchema: updateDependencyResponseSchema,
  });
}

// release intentionally bypasses the standard error-envelope check
// because `{ok: false, message: "..."}` IS a valid release response
// shape (the plugin reports a non-fatal publish failure; dv
// continues with other packages and surfaces it in the summary).
// The release-specific Zod schema fully accepts ok:false, so we let
// the response flow through to the schema validator instead of
// short-circuiting on the envelope.
export function parseReleaseResponse(
  args: ParseSingleOpResponseArgs,
): ReleaseResponse {
  return parsePluginResponse({
    rawStdout: args.rawStdout,
    pluginPath: args.pluginPath,
    opName: "release",
    responseSchema: releaseResponseSchema,
    acceptStructuredFailure: true,
  });
}

// Shared error-envelope detection + schema parsing pipeline. Every Op's
// per-schema parser routes through this so the failure shapes
// (empty stdout, non-JSON, structured envelope, shape violation) are
// identical across discover / read-version / write-version / etc.

interface ParsePluginResponseArgs<T> {
  rawStdout: string;
  pluginPath: string;
  opName: string;
  responseSchema: z.ZodType<T>;
  // Default false: any `{ok: false, error: string}` payload short-
  // circuits to PluginError. The `release` Op opts in to a more
  // permissive path because `{ok: false, message: ...}` is part of
  // its documented success shape — the plugin is reporting a
  // recoverable publish failure that should NOT abort the run.
  acceptStructuredFailure?: boolean;
}

export function parsePluginResponse<T>(args: ParsePluginResponseArgs<T>): T {
  const { rawStdout, pluginPath, opName, responseSchema } = args;
  const trimmedStdout = rawStdout.trim();
  if (trimmedStdout.length === 0) {
    throw new DvError({
      code: "plugin-bad-response",
      message: `${opName} produced empty stdout`,
      hint: "the plugin must write a JSON response to stdout — check that it isn't writing to stderr or silently exiting",
      context: { pluginPath, opName },
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmedStdout);
  } catch (caughtError) {
    const parserMessage =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    throw new DvError({
      code: "plugin-bad-response",
      message: `${opName} stdout is not valid JSON: ${parserMessage}`,
      hint: "ensure no log lines leak onto stdout; logs belong on stderr",
      context: { pluginPath, opName },
      cause: caughtError,
    });
  }

  if (args.acceptStructuredFailure !== true) {
    const envelopeAttempt = pluginErrorEnvelopeSchema.safeParse(parsedJson);
    if (envelopeAttempt.success) {
      throw new DvError({
        code: "plugin-error",
        message: `${opName} reported failure: ${envelopeAttempt.data.error}`,
        context: { pluginPath, opName },
      });
    }
  }

  const validatedResponse = responseSchema.safeParse(parsedJson);
  if (!validatedResponse.success) {
    const firstIssue = validatedResponse.error.issues[0];
    const issueLocation =
      firstIssue && firstIssue.path.length > 0
        ? firstIssue.path.join(".")
        : "<root>";
    const issueMessage = firstIssue?.message ?? "unknown shape error";
    throw new DvError({
      code: "plugin-bad-response",
      message: `${opName} response @ ${issueLocation}: ${issueMessage}`,
      hint: `compare the plugin's output to specs/schemas/plugin-responses.json (op: ${opName})`,
      context: { pluginPath, opName },
    });
  }
  return validatedResponse.data;
}
