import { z } from "zod";
import { PluginError } from "../../domain/errors.ts";

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

interface ParseDiscoverResponseArgs {
  rawStdout: string;
  pluginPath: string;
}

export function parseDiscoverResponse(
  args: ParseDiscoverResponseArgs,
): DiscoverResponse {
  return parsePluginResponse({
    rawStdout: args.rawStdout,
    pluginPath: args.pluginPath,
    opName: "discover",
    responseSchema: discoverResponseSchema,
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
}

export function parsePluginResponse<T>(args: ParsePluginResponseArgs<T>): T {
  const { rawStdout, pluginPath, opName, responseSchema } = args;
  const trimmedStdout = rawStdout.trim();
  if (trimmedStdout.length === 0) {
    throw new PluginError(
      "plugin-bad-response",
      `${opName} produced empty stdout`,
      pluginPath,
      opName,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmedStdout);
  } catch (caughtError) {
    const parserMessage =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    throw new PluginError(
      "plugin-bad-response",
      `${opName} stdout is not valid JSON: ${parserMessage}`,
      pluginPath,
      opName,
    );
  }

  const envelopeAttempt = pluginErrorEnvelopeSchema.safeParse(parsedJson);
  if (envelopeAttempt.success) {
    throw new PluginError(
      "plugin-error",
      `${opName} reported failure: ${envelopeAttempt.data.error}`,
      pluginPath,
      opName,
    );
  }

  const validatedResponse = responseSchema.safeParse(parsedJson);
  if (!validatedResponse.success) {
    const firstIssue = validatedResponse.error.issues[0];
    const issueLocation =
      firstIssue && firstIssue.path.length > 0
        ? firstIssue.path.join(".")
        : "<root>";
    const issueMessage = firstIssue?.message ?? "unknown shape error";
    throw new PluginError(
      "plugin-bad-response",
      `${opName} response @ ${issueLocation}: ${issueMessage}`,
      pluginPath,
      opName,
    );
  }
  return validatedResponse.data;
}
