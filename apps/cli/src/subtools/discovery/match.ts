import { globToRegExp, normalize } from "@std/path";

// Splits a plugin-assignment match (string | string[]) into positive globs
// (passed to the plugin's `discover` op) and negation globs (subtracted from
// the response client-side). Gitignore-style: leading `!` means exclude.

export interface SplitGlobs {
  positiveGlobs: string[];
  negativeGlobs: string[];
}

export function splitMatch(matchInput: string | string[]): SplitGlobs {
  const matchEntries = Array.isArray(matchInput) ? matchInput : [matchInput];
  const positiveGlobs: string[] = [];
  const negativeGlobs: string[] = [];
  for (const matchEntry of matchEntries) {
    if (matchEntry.startsWith("!")) {
      negativeGlobs.push(matchEntry.slice(1));
    } else {
      positiveGlobs.push(matchEntry);
    }
  }
  return { positiveGlobs, negativeGlobs };
}

// Normalizes a discovered package path for comparison: drops trailing slash,
// resolves `.` segments, leaves it relative.
export function normalizePath(packagePath: string): string {
  return normalize(packagePath).replace(/\/$/, "");
}

interface MatchesAnyArgs {
  candidatePath: string;
  globs: string[];
}

export function matchesAny(args: MatchesAnyArgs): boolean {
  const normalizedTarget = normalizePath(args.candidatePath);
  return args.globs.some((globPattern) =>
    globToRegExp(globPattern, { extended: true, globstar: true }).test(
      normalizedTarget,
    ),
  );
}
