import { join } from "@std/path";

export { defaults } from "./defaults.ts";
export { loadConfig } from "./parse.ts";

// Conventional locations relative to repo root.
export const CONFIG_DIR = ".changelog";
export const CONFIG_FILE = "config.yaml";
export const RECORDS_DIR = "records";

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_DIR, CONFIG_FILE);
}

export function recordsPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_DIR, RECORDS_DIR);
}
