import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { listRecords } from "./mod.ts";

// Tests for the records-directory listing. The interesting case is
// a missing directory: `Deno.readDir` returns its async iterator
// synchronously and only throws on first iteration, which means
// a `try/catch` around the readDir *call* never fires. An earlier
// implementation made exactly that mistake — `dv status` against
// a fresh git repo with no .dv/records/ yet would crash with
// `os error 2: readdir`. listRecords now wraps the iteration in
// the catch, so a missing directory is the same shape as an empty
// one: an empty listing.

interface WithTempDirArgs {
  testBody: (parentDirectory: string) => Promise<void>;
}

async function withTempDir(args: WithTempDirArgs): Promise<void> {
  const parentDirectory = await Deno.makeTempDir({
    prefix: "dv-list-records-",
  });
  try {
    await args.testBody(parentDirectory);
  } finally {
    await Deno.remove(parentDirectory, { recursive: true });
  }
}

Deno.test("listRecords on a MISSING records directory returns an empty listing (not an error)", async () => {
  // Given a parent dir whose `records/` child does not exist —
  // matches a fresh git repo before `dv init` runs, or a repo
  // that hasn't filed its first record yet
  await withTempDir({
    testBody: async (parentDirectory) => {
      const recordsDirectory = join(parentDirectory, "records");
      // Deliberately do NOT create recordsDirectory.

      // When listRecords runs
      const listing = await listRecords({ recordsDirectory });

      // Then both arrays are empty and nothing throws
      assertEquals(listing.parsedRecords, []);
      assertEquals(listing.failures, []);
    },
  });
});

Deno.test("listRecords on an EMPTY records directory returns an empty listing", async () => {
  // Given a real but empty records directory
  await withTempDir({
    testBody: async (parentDirectory) => {
      const recordsDirectory = join(parentDirectory, "records");
      await Deno.mkdir(recordsDirectory);

      // When listRecords runs
      const listing = await listRecords({ recordsDirectory });

      // Then the result is the same shape as the missing-dir case
      assertEquals(listing.parsedRecords, []);
      assertEquals(listing.failures, []);
    },
  });
});

Deno.test("listRecords with one well-formed record parses it and sorts by filename", async () => {
  // Given a records dir with two well-formed entries in non-sorted
  // filesystem order (we write 'z' first, then 'a')
  await withTempDir({
    testBody: async (parentDirectory) => {
      const recordsDirectory = join(parentDirectory, "records");
      await Deno.mkdir(recordsDirectory);
      const recordBody =
        "---\ntype: feat\npackages:\n  - core\n---\n\n# A feature\n";
      await Deno.writeTextFile(
        join(recordsDirectory, "z-second.md"),
        recordBody,
      );
      await Deno.writeTextFile(
        join(recordsDirectory, "a-first.md"),
        recordBody,
      );

      // When listRecords runs
      const listing = await listRecords({ recordsDirectory });

      // Then both records are parsed, in filename order
      assertEquals(listing.failures, []);
      assertEquals(listing.parsedRecords.length, 2);
      assertEquals(listing.parsedRecords[0]?.filename, "a-first.md");
      assertEquals(listing.parsedRecords[1]?.filename, "z-second.md");
    },
  });
});

Deno.test("listRecords ignores non-.md files in the records directory", async () => {
  // Given a records dir with a mix of .md and non-.md files —
  // editor backup files, .DS_Store, etc.
  await withTempDir({
    testBody: async (parentDirectory) => {
      const recordsDirectory = join(parentDirectory, "records");
      await Deno.mkdir(recordsDirectory);
      const recordBody =
        "---\ntype: fix\npackages:\n  - core\n---\n\n# Tiny fix\n";
      await Deno.writeTextFile(join(recordsDirectory, "real.md"), recordBody);
      await Deno.writeTextFile(
        join(recordsDirectory, "notes.txt"),
        "not a record",
      );
      await Deno.writeTextFile(
        join(recordsDirectory, ".DS_Store"),
        "macos junk",
      );

      // When listRecords runs
      const listing = await listRecords({ recordsDirectory });

      // Then only the .md file is picked up; the other two are
      // skipped silently
      assertEquals(listing.parsedRecords.length, 1);
      assertEquals(listing.parsedRecords[0]?.filename, "real.md");
      assertEquals(listing.failures, []);
    },
  });
});
