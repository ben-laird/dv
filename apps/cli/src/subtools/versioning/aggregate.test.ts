import { assertEquals } from "@std/assert";
import type { Record as DvRecord } from "../../domain/record.ts";
import type { Stability } from "../../domain/stability.ts";
import { buildRenameResolver } from "../renames/mod.ts";
import { aggregateBumps } from "./aggregate.ts";

function buildRecord(
  filename: string,
  type: DvRecord["type"],
  packages: string[],
): DvRecord {
  return { filename, type, packages, links: [], body: "x" };
}

Deno.test("aggregateBumps joins multiple records on one package into a single Bump", () => {
  // Given three records touching the same Stable package: two fixes and one feat
  const parsedRecords: DvRecord[] = [
    buildRecord("a.md", "fix", ["core"]),
    buildRecord("b.md", "fix", ["core"]),
    buildRecord("c.md", "feat", ["core"]),
  ];
  const knownPackageStabilities = new Map<string, Stability>([
    ["core", "Stable"],
  ]);
  const renameResolver = buildRenameResolver({ ledger: [] });

  // When aggregated
  const result = aggregateBumps({
    parsedRecords,
    renameResolver,
    knownPackageStabilities,
  });

  // Then the aggregated bump for core is minor (fix ⊔ fix ⊔ feat) and the
  // change counts reflect all three records
  const coreEntry = result.aggregatedByPackage.get("core");
  assertEquals(coreEntry?.bump, "minor");
  assertEquals(coreEntry?.changeCounts, { feat: 1, fix: 2, breaking: 0 });
  assertEquals(coreEntry?.recordFilenames, ["a.md", "b.md", "c.md"]);
  assertEquals(result.unresolvedReferences, []);
});

Deno.test("aggregateBumps produces order-independent results (commutativity of join)", () => {
  // Given the same three records in two different orders
  const recordA = buildRecord("a.md", "fix", ["core"]);
  const recordB = buildRecord("b.md", "feat", ["core"]);
  const recordC = buildRecord("c.md", "feat!", ["core"]);
  const orderA: DvRecord[] = [recordA, recordB, recordC];
  const orderB: DvRecord[] = [recordC, recordA, recordB];
  const knownPackageStabilities = new Map<string, Stability>([
    ["core", "Stable"],
  ]);
  const renameResolver = buildRenameResolver({ ledger: [] });

  // When aggregated in both orders
  const resultA = aggregateBumps({
    parsedRecords: orderA,
    renameResolver,
    knownPackageStabilities,
  });
  const resultB = aggregateBumps({
    parsedRecords: orderB,
    renameResolver,
    knownPackageStabilities,
  });

  // Then the resulting bumps agree (record filename ordering is normalized
  // by the aggregator so it's stable across input orders too)
  assertEquals(
    resultA.aggregatedByPackage.get("core")?.bump,
    resultB.aggregatedByPackage.get("core")?.bump,
  );
  assertEquals(
    resultA.aggregatedByPackage.get("core")?.recordFilenames,
    resultB.aggregatedByPackage.get("core")?.recordFilenames,
  );
});

Deno.test("aggregateBumps applies the rename ledger before deciding which Package owns a record", () => {
  // Given a record naming the old name 'core' and a ledger entry mapping
  // core → engine
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "feat", ["core"])];
  const knownPackageStabilities = new Map<string, Stability>([
    ["engine", "Stable"],
  ]);
  const renameResolver = buildRenameResolver({
    ledger: [{ from: "core", to: "engine", at: "1.0.0" }],
  });

  // When aggregated
  const result = aggregateBumps({
    parsedRecords,
    renameResolver,
    knownPackageStabilities,
  });

  // Then the bump lands on engine, not core, and there are no unresolved
  // references
  assertEquals(result.aggregatedByPackage.get("engine")?.bump, "minor");
  assertEquals(result.aggregatedByPackage.has("core"), false);
  assertEquals(result.unresolvedReferences, []);
});

Deno.test("aggregateBumps reports an Unresolved Reference when no Package matches", () => {
  // Given a record referencing a package that is neither in discovery
  // nor in the rename ledger
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "fix", ["mystery"])];
  const knownPackageStabilities = new Map<string, Stability>([
    ["core", "Stable"],
  ]);
  const renameResolver = buildRenameResolver({ ledger: [] });

  // When aggregated
  const result = aggregateBumps({
    parsedRecords,
    renameResolver,
    knownPackageStabilities,
  });

  // Then no bump is recorded and the reference appears in the unresolved
  // list with its source filename
  assertEquals(result.aggregatedByPackage.size, 0);
  assertEquals(result.unresolvedReferences, [
    { recordFilename: "a.md", reference: "mystery" },
  ]);
});

Deno.test("aggregateBumps caps pre-1.0 breaking changes at minor (Algebra §3)", () => {
  // Given a breaking record on an Unstable package
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "feat!", ["core"])];
  const knownPackageStabilities = new Map<string, Stability>([
    ["core", "Unstable"],
  ]);
  const renameResolver = buildRenameResolver({ ledger: [] });

  // When aggregated
  const result = aggregateBumps({
    parsedRecords,
    renameResolver,
    knownPackageStabilities,
  });

  // Then the aggregated bump is minor (capped from major), the breaking
  // count is 1 (counts are independent of the cap)
  const coreEntry = result.aggregatedByPackage.get("core");
  assertEquals(coreEntry?.bump, "minor");
  assertEquals(coreEntry?.changeCounts, { feat: 1, fix: 0, breaking: 1 });
});
