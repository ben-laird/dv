import { assertEquals, assertThrows } from "@std/assert";
import { RenameLedgerError } from "./load.ts";
import { buildRenameResolver } from "./resolve.ts";

Deno.test("buildRenameResolver returns the input as-is when no edges match (reflexive case)", () => {
  // Given an empty rename ledger
  const renameResolver = buildRenameResolver({ ledger: [] });

  // When a Package reference is resolved
  const resolved = renameResolver.resolve("core");

  // Then resolution returns the input verbatim (the closure includes
  // every node as itself).
  assertEquals(resolved, "core");
});

Deno.test("buildRenameResolver follows multi-hop chains via transitive closure", () => {
  // Given a ledger with `core → engine → runtime`
  const renameResolver = buildRenameResolver({
    ledger: [
      { from: "core", to: "engine", at: "1.3.0" },
      { from: "engine", to: "runtime", at: "2.0.0" },
    ],
  });

  // When the oldest name is resolved
  const resolvedTarget = renameResolver.resolve("core");

  // Then the closure walks both edges to land on the current name
  assertEquals(resolvedTarget, "runtime");
});

Deno.test("buildRenameResolver rejects a ledger with two outgoing edges from one source", () => {
  // Given a ledger that says `core → engine` AND `core → runtime`
  // — the closure can't be a function under those edges
  const ambiguousLedger = [
    { from: "core", to: "engine", at: "1.3.0" },
    { from: "core", to: "runtime", at: "1.5.0" },
  ];

  // When we try to build the resolver
  // Then construction throws a ledger-duplicate-edge error
  assertThrows(
    () => buildRenameResolver({ ledger: ambiguousLedger }),
    RenameLedgerError,
    "two outgoing edges",
  );
});

Deno.test("buildRenameResolver detects cycles when resolving a ref", () => {
  // Given a ledger with a 2-cycle: core → engine → core
  const cyclicLedger = [
    { from: "core", to: "engine", at: "1.0.0" },
    { from: "engine", to: "core", at: "2.0.0" },
  ];
  const renameResolver = buildRenameResolver({ ledger: cyclicLedger });

  // When we try to resolve a name on the cycle
  // Then resolve throws a ledger-cycle error
  assertThrows(
    () => renameResolver.resolve("core"),
    RenameLedgerError,
    "cycle",
  );
});

Deno.test("buildRenameResolver leaves Unresolved References as themselves (callers detect)", () => {
  // Given a ledger with one chain
  const renameResolver = buildRenameResolver({
    ledger: [{ from: "core", to: "engine", at: "1.0.0" }],
  });

  // When resolving a name that's not on any chain
  const resolved = renameResolver.resolve("orphan");

  // Then the reference is returned verbatim — Unresolved References are
  // detected by the caller (typically `dv version` / `dv validate`)
  // checking the result against the discovered Package set.
  assertEquals(resolved, "orphan");
});
