import { join } from "@std/path";

// Filesystem locations dv assumes inside any repo it manages. Kept in
// its own module (not mod.ts) so internal subtool files can import the
// constants without pulling in mod.ts's re-export graph, which would
// create cycles with parse.ts.

export const CONFIG_DIR = ".dv";
export const CONFIG_FILE = "config.yaml";
export const RECORDS_DIR = "records";

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_DIR, CONFIG_FILE);
}

export function recordsPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_DIR, RECORDS_DIR);
}
