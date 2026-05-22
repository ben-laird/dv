import { buildFreshHistory, prependHistorySection } from "./prepend.ts";

// IO wrappers around the pure prepend/render helpers. Reads the
// existing HISTORY.md (if any), splices the new section in, writes
// the result back. Used by `dv version` once per Package being bumped
// when `history.enabled` is true.

export interface UpsertHistorySectionArgs {
  historyPath: string;
  newSection: string;
}

export async function upsertHistorySection(
  args: UpsertHistorySectionArgs,
): Promise<void> {
  const existingText = await readExistingHistory(args.historyPath);
  const updatedText =
    existingText === null
      ? buildFreshHistory(args.newSection)
      : prependHistorySection({
          existingText,
          newSection: args.newSection,
        });
  await Deno.writeTextFile(args.historyPath, updatedText);
}

async function readExistingHistory(
  historyPath: string,
): Promise<string | null> {
  try {
    return await Deno.readTextFile(historyPath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return null;
    throw caughtError;
  }
}
