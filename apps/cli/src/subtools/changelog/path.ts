import { join } from "@std/path";
import type { Package } from "../../domain/package.ts";

// Resolves a per-Package output path (CHANGELOG.md, HISTORY.md) from a
// config location template. Pure string substitution joined onto the repo
// root. Shared by `dv version`, `dv v1`, and `dv release` so the path a
// section is written to and the path it's later read back from never drift.

export interface ResolveOutputPathFromTemplateArgs {
  /** The Package the path is being resolved for. */
  package: Package;
  /** The config location template, e.g. `{package-path}/CHANGELOG.md`. */
  locationTemplate: string;
  /** The Version, substituted for `{version}` in the template. */
  newVersion: string;
  /** Absolute repo root the rendered relative path is joined onto. */
  repoRootPath: string;
}

/** Fills `{package}`, `{package-path}`, `{version}` and joins onto the root. */
export function resolveOutputPathFromTemplate(
  args: ResolveOutputPathFromTemplateArgs,
): string {
  const rendered = args.locationTemplate
    .replaceAll("{package}", args.package.name)
    .replaceAll("{package-path}", args.package.path)
    .replaceAll("{version}", args.newVersion);
  return join(args.repoRootPath, rendered);
}
