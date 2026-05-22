import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { loadRenameLedger, RenameLedgerError } from "./load.ts";

interface WithLedgerArgs {
  ledgerYaml: string;
  testBody: (ledgerPath: string) => Promise<void>;
}

async function withLedger(args: WithLedgerArgs): Promise<void> {
  const tempDirectory = await Deno.makeTempDir({ prefix: "dv-rename-" });
  try {
    const ledgerPath = join(tempDirectory, "renames.yaml");
    await Deno.writeTextFile(ledgerPath, args.ledgerYaml);
    await args.testBody(ledgerPath);
  } finally {
    await Deno.remove(tempDirectory, { recursive: true });
  }
}

Deno.test("loadRenameLedger returns [] when the ledger file is missing", async () => {
  // Given a path where no file exists
  const missingLedgerPath = "/tmp/dv-test-missing-XQ7/renames.yaml";

  // When loadRenameLedger runs
  const ledgerEntries = await loadRenameLedger({
    ledgerPath: missingLedgerPath,
  });

  // Then the result is the empty ledger (no error)
  assertEquals(ledgerEntries, []);
});

Deno.test("loadRenameLedger parses a valid ledger into typed entries", async () => {
  await withLedger({
    ledgerYaml: `
- from: core
  to: engine
  at: 1.3.0
- from: engine
  to: runtime
  at: 2.0.0
`,
    testBody: async (ledgerPath) => {
      // When the ledger is loaded
      const ledgerEntries = await loadRenameLedger({ ledgerPath });

      // Then both edges are preserved in order
      assertEquals(ledgerEntries.length, 2);
      assertEquals(ledgerEntries[0], {
        from: "core",
        to: "engine",
        at: "1.3.0",
      });
      assertEquals(ledgerEntries[1], {
        from: "engine",
        to: "runtime",
        at: "2.0.0",
      });
    },
  });
});

Deno.test("loadRenameLedger rejects an entry missing the `at` field", async () => {
  await withLedger({
    ledgerYaml: `
- from: core
  to: engine
`,
    testBody: async (ledgerPath) => {
      // When the ledger is loaded
      // Then RenameLedgerError surfaces the shape violation
      await assertRejects(
        () => loadRenameLedger({ ledgerPath }),
        RenameLedgerError,
        "at",
      );
    },
  });
});

Deno.test("loadRenameLedger rejects malformed YAML", async () => {
  await withLedger({
    ledgerYaml: `:::not yaml at all:::\n`,
    testBody: async (ledgerPath) => {
      // When loadRenameLedger runs
      // Then RenameLedgerError reports the parse failure
      await assertRejects(
        () => loadRenameLedger({ ledgerPath }),
        RenameLedgerError,
      );
    },
  });
});
