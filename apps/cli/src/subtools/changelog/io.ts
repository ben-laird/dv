import { buildFreshChangelog, prependChangelogSection } from "./prepend.ts";

// IO wrappers around the pure prepend/render helpers. Reads the
// existing CHANGELOG.md (if any), splices the new section in, writes
// the result back. Used by `dv version` once per Package being bumped.

export interface UpsertChangelogSectionArgs {
  changelogPath: string;
  newSection: string;
}

export async function upsertChangelogSection(
  args: UpsertChangelogSectionArgs,
): Promise<void> {
  const existingText = await readExistingChangelog(args.changelogPath);
  const updatedText =
    existingText === null
      ? buildFreshChangelog(args.newSection)
      : prependChangelogSection({
          existingText,
          newSection: args.newSection,
        });
  await Deno.writeTextFile(args.changelogPath, updatedText);
}

async function readExistingChangelog(
  changelogPath: string,
): Promise<string | null> {
  try {
    return await Deno.readTextFile(changelogPath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return null;
    throw caughtError;
  }
}
