// dv's own version string. Single source of truth for both the
// `--version` output (main.ts) and the status banner (cli/status.ts).
// Derived from apps/cli/deno.json, which `dv version` bumps on release,
// so the reported version can never drift from the published one.

import { z } from "zod";
import denoJson from "../deno.json" with { type: "json" };

const PackageManifestSchema = z.object({ version: z.string().min(1) });

/** The version of the running `dv`, read from the package manifest. */
export const DV_VERSION: string = PackageManifestSchema.parse(denoJson).version;

// Short product tagline used in the banner. Kept terse — anything
// longer overflows narrow terminals.
export const DV_TAGLINE = "changelog as code";
