// dv's own version string. Single source of truth for both the
// `--version` output (main.ts) and the status banner (cli/status.ts).
// Kept in code rather than read from deno.json at runtime so the
// constant is statically inlined and the install-shim doesn't need
// extra file IO at startup. It IS hand-maintained alongside
// apps/cli/deno.json's "version" field; the schemas:check-style
// drift problem could in principle be handled by a future
// `deno task version:check` gate but isn't worth it for one literal.

export const DV_VERSION = "0.1.0";

// Short product tagline used in the banner. Kept terse — anything
// longer overflows narrow terminals.
export const DV_TAGLINE = "changelog as code";
