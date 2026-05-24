import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { appendRenameEntry } from "./append.ts";
import { loadRenameLedger } from "./load.ts";

// appendRenameEntry is the writer behind `dv rename`. The interesting
// behaviors to pin down:
//   - missing ledger → file is created with a header comment
//   - existing ledger with user comments → comments survive the append
//     (we deliberately don't round-trip through @std/yaml)
//   - duplicate `from` edge → typed DvError before any IO happens
//   - the appended entry is loadable by loadRenameLedger (round-trip)

interface WithTempDirArgs {
  testBody: (tempDirectory: string) => Promise<void>;
}

async function withTempDir(args: WithTempDirArgs): Promise<void> {
  const tempDirectory = await Deno.makeTempDir({
    prefix: "dv-rename-append-",
  });
  try {
    await args.testBody(tempDirectory);
  } finally {
    await Deno.remove(tempDirectory, { recursive: true });
  }
}

Deno.test("appendRenameEntry creates the ledger file when it does not exist", async () => {
  // Given a path where no ledger file has been written yet — the
  // common case the first time `dv rename` runs in a repo
  await withTempDir({
    testBody: async (tempDirectory) => {
      const ledgerPath = join(tempDirectory, "renames.yaml");

      // When appendRenameEntry writes a first entry
      const result = await appendRenameEntry({
        ledgerPath,
        fromPackageName: "core",
        toPackageName: "engine",
        atVersion: "1.3.0",
      });

      // Then the file exists, the result reports `fileCreated`, and
      // loading it back yields exactly the one entry
      assert(result.fileCreated);
      const reloaded = await loadRenameLedger({ ledgerPath });
      assertEquals(reloaded, [{ from: "core", to: "engine", at: "1.3.0" }]);
    },
  });
});

Deno.test("appendRenameEntry preserves user-written comments in an existing ledger", async () => {
  // Given a ledger the user has hand-edited with comments — round-
  // tripping through @std/yaml would destroy those, which is exactly
  // why this writer is text-based instead.
  await withTempDir({
    testBody: async (tempDirectory) => {
      const ledgerPath = join(tempDirectory, "renames.yaml");
      const handWrittenLedger =
        "# This ledger is sacred — humans only past this line.\n" +
        "- from: core\n" +
        "  to: engine\n" +
        '  at: "1.3.0"\n' +
        "  # ^ first version after the rename in Q3\n";
      await Deno.writeTextFile(ledgerPath, handWrittenLedger);

      // When appendRenameEntry adds a new edge
      await appendRenameEntry({
        ledgerPath,
        fromPackageName: "engine",
        toPackageName: "runtime",
        atVersion: "2.0.0",
      });

      // Then both the header comment and the per-entry annotation
      // survive intact, and the new entry sits at the bottom
      const finalText = await Deno.readTextFile(ledgerPath);
      assert(
        finalText.includes("# This ledger is sacred"),
        "header comment must survive",
      );
      assert(
        finalText.includes("# ^ first version after the rename in Q3"),
        "per-entry annotation must survive",
      );
      const reloaded = await loadRenameLedger({ ledgerPath });
      assertEquals(reloaded, [
        { from: "core", to: "engine", at: "1.3.0" },
        { from: "engine", to: "runtime", at: "2.0.0" },
      ]);
    },
  });
});

Deno.test("appendRenameEntry rejects a duplicate `from` edge with ledger-duplicate-edge", async () => {
  // Given a ledger that already maps `core → engine` — adding a
  // second outgoing edge from `core` would make the closure non-
  // functional (Algebra §8), which resolve.ts also rejects at read
  // time. We catch it at write time to fail closer to the user.
  await withTempDir({
    testBody: async (tempDirectory) => {
      const ledgerPath = join(tempDirectory, "renames.yaml");
      await Deno.writeTextFile(
        ledgerPath,
        "- from: core\n  to: engine\n  at: 1.3.0\n",
      );

      // When appendRenameEntry tries to add a second `from: core`
      // Then it throws a DvError with code `ledger-duplicate-edge`
      // and the file is left untouched
      const caughtError = await assertRejects(
        () =>
          appendRenameEntry({
            ledgerPath,
            fromPackageName: "core",
            toPackageName: "kernel",
            atVersion: "1.5.0",
          }),
        DvError,
      );
      assertEquals(caughtError.kind.code, "ledger-duplicate-edge");
      const reloaded = await loadRenameLedger({ ledgerPath });
      assertEquals(reloaded, [{ from: "core", to: "engine", at: "1.3.0" }]);
    },
  });
});

Deno.test("appendRenameEntry rejects empty arguments", async () => {
  // Given any arg whose runtime value is empty (CLI input slipped
  // past flag parsing somehow) — match the schema's `.min(1)`
  await withTempDir({
    testBody: async (tempDirectory) => {
      const ledgerPath = join(tempDirectory, "renames.yaml");

      // When `from` is empty
      // Then a DvError with code `ledger-shape` is thrown
      const caughtError = await assertRejects(
        () =>
          appendRenameEntry({
            ledgerPath,
            fromPackageName: "",
            toPackageName: "engine",
            atVersion: "1.0.0",
          }),
        DvError,
      );
      assertEquals(caughtError.kind.code, "ledger-shape");
    },
  });
});
