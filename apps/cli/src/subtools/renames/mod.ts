import { join } from "@std/path";
import { CONFIG_DIR } from "../config/mod.ts";

export {
  type AppendRenameEntryArgs,
  type AppendRenameEntryResult,
  appendRenameEntry,
} from "./append.ts";
export { loadRenameLedger, RenameLedgerError } from "./load.ts";
export { buildRenameResolver, type RenameResolver } from "./resolve.ts";
export { renameLedgerEntrySchema, renameLedgerSchema } from "./schema.ts";

export const RENAMES_FILE = "renames.yaml";

export function renamesPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_DIR, RENAMES_FILE);
}
