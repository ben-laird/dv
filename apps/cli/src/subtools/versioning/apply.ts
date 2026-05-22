import type { Bump } from "../../domain/bump.ts";
import type { Version } from "../../domain/version.ts";

// applyBump performs a Bump on a Version per specs/language.md § apply.
// Pure; never widens the major component when the input is Unstable —
// because the input Bump itself is the output of `classify` and is
// therefore capped (Algebra §3).

export interface ApplyBumpArgs {
  version: Version;
  bump: Bump;
}

export function applyBump(args: ApplyBumpArgs): Version {
  const { version, bump } = args;
  const base = { prerelease: [], build: [] };
  switch (bump) {
    case "patch":
      return {
        ...base,
        major: version.major,
        minor: version.minor,
        patch: version.patch + 1,
      };
    case "minor":
      return {
        ...base,
        major: version.major,
        minor: version.minor + 1,
        patch: 0,
      };
    case "major":
      return { ...base, major: version.major + 1, minor: 0, patch: 0 };
  }
}
