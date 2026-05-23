import { join } from "@std/path";
import type { Record as DvRecord } from "../../domain/record.ts";
import { parseRecord, RecordError } from "./parse.ts";

// Public surface of the records Subtool. Lower-level building blocks
// (the Zod schema, the parser, the serializer, the slug generator) are
// available from their own modules.

export { parseRecord, RecordError } from "./parse.ts";
export {
  type ParsedRecordFrontmatter,
  parsedRecordFrontmatterSchema,
  type RawRecordFrontmatter,
  rawRecordFrontmatterSchema,
} from "./schema.ts";
export { type SerializeRecordArgs, serializeRecord } from "./serialize.ts";
export {
  defaultRandomSource,
  generateSlug,
  type SlugRandomSource,
} from "./slug.ts";

// Result of a directory scan: parsed Records on one side, malformed
// entries on the other. Callers (notably `dv validate`) want both — a
// single bad Record should not hide all the others.

export interface RecordsListing {
  parsedRecords: DvRecord[];
  failures: RecordError[];
}

interface ListRecordsArgs {
  recordsDirectory: string;
}

export async function listRecords(
  args: ListRecordsArgs,
): Promise<RecordsListing> {
  const { recordsDirectory } = args;
  const parsedRecords: DvRecord[] = [];
  const failures: RecordError[] = [];

  // A missing records directory is a legitimate "no records yet"
  // state — the same shape an empty directory produces. Treat both
  // as an empty listing instead of throwing, so commands that only
  // ever read records (`dv status`, `dv validate`) work on a fresh
  // repo where `dv init` hasn't run yet, and commands that write
  // records (`dv add`) create the directory before they get here.
  //
  // The catch wraps the `for await` rather than the `Deno.readDir`
  // call itself: readDir returns the async iterator synchronously
  // and only throws on first iteration (the prior synchronous
  // try/catch around readDir never fired).
  try {
    for await (const directoryEntry of Deno.readDir(recordsDirectory)) {
      if (!directoryEntry.isFile) continue;
      if (!directoryEntry.name.endsWith(".md")) continue;
      const recordPath = join(recordsDirectory, directoryEntry.name);
      const fileContents = await Deno.readTextFile(recordPath);
      try {
        parsedRecords.push(parseRecord({ fileContents, recordPath }));
      } catch (caughtError) {
        if (caughtError instanceof RecordError) {
          failures.push(caughtError);
        } else {
          throw caughtError;
        }
      }
    }
  } catch (caughtError) {
    if (!(caughtError instanceof Deno.errors.NotFound)) throw caughtError;
    // Directory doesn't exist → empty listing. Fall through to the
    // sort + return below; both arrays are still empty.
  }
  parsedRecords.sort((leftRecord, rightRecord) =>
    leftRecord.filename.localeCompare(rightRecord.filename),
  );
  failures.sort((leftFailure, rightFailure) =>
    leftFailure.recordPath.localeCompare(rightFailure.recordPath),
  );
  return { parsedRecords, failures };
}
