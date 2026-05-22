import type { Package } from "../../domain/package.ts";

// Renders a tag string from `config.tagging.format` (default
// `{package}@{version}`). Pure: just substitutes the template
// variables. Mirrors the path-template machinery used by changelog
// and history rendering, deliberately kept as a separate helper so
// the "what's the tag for this package + version?" question has one
// answer in the codebase.
//
// Per-package overrides (`overrides[].tagging`) are documented in
// specs/config-format.md but NOT yet honored — the caller only
// passes the top-level template. Polish for the MVP refinement
// pass.

export interface FormatTagArgs {
  package: Package;
  version: string;
  template: string;
}

export function formatTag(args: FormatTagArgs): string {
  return args.template
    .replaceAll("{package}", args.package.name)
    .replaceAll("{package-path}", args.package.path)
    .replaceAll("{version}", args.version);
}
