import { z } from "zod";
import { PluginError } from "../../domain/errors.ts";

// Zod schemas for plugin Op responses, per specs/schemas/plugin-responses.json.
// One schema per Op; the runner pipes raw stdout through the matching
// schema. The optional structured-error envelope (`{ ok: false, error: "..." }`)
// is recognized for any Op and turned into a PluginError.
//
// Per [[feedback-zod-for-contracts]], every plugin stdio boundary is
// validated through Zod, not hand-rolled.

const pluginErrorEnvelopeSchema = z
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
  const { rawStdout, pluginPath } = args;
  const trimmedStdout = rawStdout.trim();
  if (trimmedStdout.length === 0) {
    throw new PluginError(
      "plugin-bad-response",
      "discover produced empty stdout",
      pluginPath,
      "discover",
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
      `discover stdout is not valid JSON: ${parserMessage}`,
      pluginPath,
      "discover",
    );
  }

  const envelopeAttempt = pluginErrorEnvelopeSchema.safeParse(parsedJson);
  if (envelopeAttempt.success) {
    throw new PluginError(
      "plugin-error",
      `discover reported failure: ${envelopeAttempt.data.error}`,
      pluginPath,
      "discover",
    );
  }

  const validatedResponse = discoverResponseSchema.safeParse(parsedJson);
  if (!validatedResponse.success) {
    const firstIssue = validatedResponse.error.issues[0];
    const issueLocation =
      firstIssue && firstIssue.path.length > 0
        ? firstIssue.path.join(".")
        : "<root>";
    const issueMessage = firstIssue?.message ?? "unknown shape error";
    throw new PluginError(
      "plugin-bad-response",
      `discover response @ ${issueLocation}: ${issueMessage}`,
      pluginPath,
      "discover",
    );
  }
  return validatedResponse.data;
}
