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

  const directoryHandle = openRecordsDirectory(recordsDirectory);
  if (directoryHandle === null) return { parsedRecords, failures };

  for await (const directoryEntry of directoryHandle) {
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
  parsedRecords.sort((leftRecord, rightRecord) =>
    leftRecord.filename.localeCompare(rightRecord.filename),
  );
  failures.sort((leftFailure, rightFailure) =>
    leftFailure.recordPath.localeCompare(rightFailure.recordPath),
  );
  return { parsedRecords, failures };
}

function openRecordsDirectory(
  recordsDirectory: string,
): AsyncIterable<Deno.DirEntry> | null {
  try {
    return Deno.readDir(recordsDirectory);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return null;
    throw caughtError;
  }
}
