import { assertEquals } from "@std/assert";
import type { Package } from "../../domain/package.ts";
import type { Record as DvRecord } from "../../domain/record.ts";
import type { Rename } from "../../domain/rename.ts";
import { parseVersion } from "../../domain/version.ts";
import { buildVersionPlan, type PackageCurrentVersionEntry } from "./plan.ts";
import { rawPlanSchema } from "./plan-schema.ts";

function buildPackage(name: string, path: string): Package {
  return { name, path, plugin: "./examples/plugins/deno" };
}

function buildRecord(
  filename: string,
  type: DvRecord["type"],
  packages: string[],
): DvRecord {
  return { filename, type, packages, links: [], body: "x" };
}

function packageVersion(
  packageName: string,
  versionText: string,
): PackageCurrentVersionEntry {
  return { packageName, currentVersion: parseVersion(versionText) };
}

Deno.test("buildVersionPlan returns an empty plan when no records are pending", () => {
  // Given a single discovered package with a known version but no records
  const discoveredPackages = [buildPackage("core", "packages/core")];
  const packageCurrentVersions = [packageVersion("core", "1.4.2")];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords: [],
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then pending is empty and the Plan still validates against the schema
  assertEquals(plan.pending, []);
  assertEquals(plan.unresolvedReferences, []);
  assertEquals(plan.awaitingRelease, []);
  rawPlanSchema.parse(plan);
});

Deno.test("buildVersionPlan aggregates records into per-Package projected versions", () => {
  // Given two packages and three records (two on core, one on cli)
  const discoveredPackages = [
    buildPackage("core", "packages/core"),
    buildPackage("cli", "packages/cli"),
  ];
  const parsedRecords: DvRecord[] = [
    buildRecord("a.md", "feat", ["core"]),
    buildRecord("b.md", "fix", ["core"]),
    buildRecord("c.md", "fix", ["cli"]),
  ];
  const packageCurrentVersions = [
    packageVersion("core", "1.4.2"),
    packageVersion("cli", "0.8.0"),
  ];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "version",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then pending entries appear in package-name order with the bumps the
  // algebra prescribes
  assertEquals(plan.pending.length, 2);
  assertEquals(plan.pending[0]?.package, "cli");
  assertEquals(plan.pending[0]?.currentVersion, "0.8.0");
  assertEquals(plan.pending[0]?.projectedVersion, "0.8.1");
  assertEquals(plan.pending[0]?.bump, "patch");
  assertEquals(plan.pending[1]?.package, "core");
  assertEquals(plan.pending[1]?.currentVersion, "1.4.2");
  assertEquals(plan.pending[1]?.projectedVersion, "1.5.0");
  assertEquals(plan.pending[1]?.bump, "minor");
  assertEquals(plan.pending[1]?.records, ["a.md", "b.md"]);
  assertEquals(plan.pending[1]?.changeCounts, { feat: 1, fix: 1, breaking: 0 });
  rawPlanSchema.parse(plan);
});

Deno.test("buildVersionPlan resolves package references through the rename ledger", () => {
  // Given a record naming an old package name and a ledger that maps it
  const discoveredPackages = [buildPackage("engine", "packages/engine")];
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "feat", ["core"])];
  const renameLedger: Rename[] = [{ from: "core", to: "engine", at: "1.0.0" }];
  const packageCurrentVersions = [packageVersion("engine", "1.2.3")];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "version",
    discoveredPackages,
    parsedRecords,
    renameLedger,
    packageCurrentVersions,
  });

  // Then the bump lands on the current package, not the old name
  assertEquals(plan.pending.length, 1);
  assertEquals(plan.pending[0]?.package, "engine");
  assertEquals(plan.pending[0]?.projectedVersion, "1.3.0");
  assertEquals(plan.unresolvedReferences, []);
});

Deno.test("buildVersionPlan reports Unresolved References for records pointing at no Package", () => {
  // Given a record naming an undiscovered package with no rename edge
  const discoveredPackages = [buildPackage("core", "packages/core")];
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "fix", ["mystery"])];
  const packageCurrentVersions = [packageVersion("core", "1.0.0")];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "version",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then the reference is reported (status/dry-run can show it) and no
  // bump lands
  assertEquals(plan.pending.length, 0);
  assertEquals(plan.unresolvedReferences, [
    { record: "a.md", reference: "mystery" },
  ]);
});

Deno.test("buildVersionPlan caps Unstable breaking changes at minor (Algebra §3)", () => {
  // Given a breaking record on a pre-1.0 package
  const discoveredPackages = [buildPackage("core", "packages/core")];
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "feat!", ["core"])];
  const packageCurrentVersions = [packageVersion("core", "0.4.2")];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "version",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then the projected version stays in 0.x — the cap forbids 1.0.0
  assertEquals(plan.pending[0]?.bump, "minor");
  assertEquals(plan.pending[0]?.stability, "Unstable");
  assertEquals(plan.pending[0]?.projectedVersion, "0.5.0");
});

Deno.test("buildVersionPlan produces JSON that validates against rawPlanSchema", () => {
  // Given a mixed input set
  const discoveredPackages = [
    buildPackage("core", "packages/core"),
    buildPackage("cli", "packages/cli"),
  ];
  const parsedRecords: DvRecord[] = [
    buildRecord("a.md", "feat", ["core"]),
    buildRecord("b.md", "fix!", ["cli"]),
  ];
  const packageCurrentVersions = [
    packageVersion("core", "1.0.0"),
    packageVersion("cli", "0.3.0"),
  ];

  // When built and round-tripped through JSON
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });
  const roundTripped = JSON.parse(JSON.stringify(plan));

  // Then the JSON round trip is contract-valid
  rawPlanSchema.parse(roundTripped);
});

Deno.test("buildVersionPlan lists every other discovered Package as a candidate constraint update when dependency edges are unknown", () => {
  // Given two packages where one is bumped and NO dependency graph is
  // supplied (the plugin doesn't implement get-dependencies)
  const discoveredPackages = [
    buildPackage("core", "packages/core"),
    buildPackage("cli", "packages/cli"),
  ];
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "feat", ["core"])];
  const packageCurrentVersions = [
    packageVersion("core", "1.4.2"),
    packageVersion("cli", "0.8.0"),
  ];

  // When the plan is built without dependencyEdges
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then the bumped package's pending entry lists the other discovered
  // package as a candidate (conservative fallback); cli is NOT in pending
  assertEquals(plan.pending.length, 1);
  assertEquals(plan.pending[0]?.package, "core");
  assertEquals(plan.pending[0]?.constraintUpdates, [
    { dependent: "cli", newConstraint: "1.5.0" },
  ]);
});

Deno.test("buildVersionPlan lists a dependent in constraintUpdates when the dependency graph confirms the edge", () => {
  // Given cli genuinely depends on core, per the resolved edges
  const discoveredPackages = [
    buildPackage("core", "packages/core"),
    buildPackage("cli", "packages/cli"),
  ];
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "feat", ["core"])];
  const packageCurrentVersions = [
    packageVersion("core", "1.4.2"),
    packageVersion("cli", "0.8.0"),
  ];
  const dependencyEdges = new Map([["cli", new Set(["core"])]]);

  // When the plan is built with the edges
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
    dependencyEdges,
  });

  // Then cli is listed — it really does depend on core
  assertEquals(plan.pending[0]?.constraintUpdates, [
    { dependent: "cli", newConstraint: "1.5.0" },
  ]);
});

Deno.test("buildVersionPlan omits a non-dependent from constraintUpdates when the dependency graph proves no edge", () => {
  // Given the @dv-cli/dv → @dv-cli/clipc shape: dv bumps, but clipc does
  // NOT depend on dv (clipc's resolved edges are empty)
  const discoveredPackages = [
    buildPackage("@dv-cli/dv", "apps/cli"),
    buildPackage("@dv-cli/clipc", "packages/clipc"),
  ];
  const parsedRecords: DvRecord[] = [
    buildRecord("a.md", "fix", ["@dv-cli/dv"]),
  ];
  const packageCurrentVersions = [
    packageVersion("@dv-cli/dv", "0.7.0"),
    packageVersion("@dv-cli/clipc", "0.3.0"),
  ];
  const dependencyEdges = new Map([["@dv-cli/clipc", new Set<string>()]]);

  // When the plan is built with the edges
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
    dependencyEdges,
  });

  // Then clipc is NOT listed — it carries no dependency on dv, so the
  // misleading "would update dependents: clipc" line is gone
  assertEquals(plan.pending[0]?.package, "@dv-cli/dv");
  assertEquals(plan.pending[0]?.constraintUpdates, []);
});

Deno.test("buildVersionPlan sorts constraintUpdates by dependent for byte-stable output", () => {
  // Given three packages where the middle one (by sort order) bumps
  const discoveredPackages = [
    buildPackage("b", "packages/b"),
    buildPackage("a", "packages/a"),
    buildPackage("c", "packages/c"),
  ];
  const parsedRecords: DvRecord[] = [buildRecord("x.md", "feat", ["b"])];
  const packageCurrentVersions = [
    packageVersion("a", "1.0.0"),
    packageVersion("b", "1.0.0"),
    packageVersion("c", "1.0.0"),
  ];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then b's constraintUpdates are sorted alphabetically (a, c — not
  // insertion-order b's neighbours), and the same plan rebuilt
  // produces an identical structure
  assertEquals(plan.pending[0]?.package, "b");
  assertEquals(plan.pending[0]?.constraintUpdates, [
    { dependent: "a", newConstraint: "1.1.0" },
    { dependent: "c", newConstraint: "1.1.0" },
  ]);

  const rebuiltPlan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });
  assertEquals(plan, rebuiltPlan);
});

Deno.test("buildVersionPlan excludes the bumped Package from its own constraintUpdates", () => {
  // Given a single-package repo with one feat record
  const discoveredPackages = [buildPackage("solo", "packages/solo")];
  const parsedRecords: DvRecord[] = [buildRecord("x.md", "feat", ["solo"])];
  const packageCurrentVersions = [packageVersion("solo", "1.0.0")];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then constraintUpdates is empty — solo never lists itself
  assertEquals(plan.pending[0]?.constraintUpdates, []);
});

Deno.test("buildVersionPlan lists mutual constraintUpdates when two packages both bump", () => {
  // Given two packages, both with records
  const discoveredPackages = [
    buildPackage("alpha", "packages/alpha"),
    buildPackage("beta", "packages/beta"),
  ];
  const parsedRecords: DvRecord[] = [
    buildRecord("a.md", "feat", ["alpha"]),
    buildRecord("b.md", "fix", ["beta"]),
  ];
  const packageCurrentVersions = [
    packageVersion("alpha", "1.0.0"),
    packageVersion("beta", "1.0.0"),
  ];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then each bumped package lists the other as a constraint update,
  // with that other's projected version
  const alphaEntry = plan.pending.find((p) => p.package === "alpha");
  const betaEntry = plan.pending.find((p) => p.package === "beta");
  assertEquals(alphaEntry?.constraintUpdates, [
    { dependent: "beta", newConstraint: "1.1.0" },
  ]);
  assertEquals(betaEntry?.constraintUpdates, [
    { dependent: "alpha", newConstraint: "1.0.1" },
  ]);
});

Deno.test("buildVersionPlan lists constraintUpdates for unbumped dependents too", () => {
  // Given three packages where only one bumps
  const discoveredPackages = [
    buildPackage("a", "packages/a"),
    buildPackage("b", "packages/b"),
    buildPackage("c", "packages/c"),
  ];
  const parsedRecords: DvRecord[] = [buildRecord("x.md", "feat", ["a"])];
  const packageCurrentVersions = [
    packageVersion("a", "1.0.0"),
    packageVersion("b", "1.0.0"),
    packageVersion("c", "1.0.0"),
  ];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then a is the only pending entry (Algebra §9: cascading does not
  // induce bumps) but its constraintUpdates names both b and c
  assertEquals(plan.pending.length, 1);
  assertEquals(plan.pending[0]?.constraintUpdates, [
    { dependent: "b", newConstraint: "1.1.0" },
    { dependent: "c", newConstraint: "1.1.0" },
  ]);
});

Deno.test("buildVersionPlan populates `tracked` with every discovered Package and its version", () => {
  // Given three discovered packages with known versions but no records
  const discoveredPackages = [
    buildPackage("b", "packages/b"),
    buildPackage("a", "packages/a"),
    buildPackage("c", "packages/c"),
  ];
  const packageCurrentVersions = [
    packageVersion("a", "1.0.0"),
    packageVersion("b", "0.4.2"),
    packageVersion("c", "2.1.0"),
  ];

  // When the plan is built (no records)
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords: [],
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then every package appears in `tracked`, sorted by name, with its
  // current version and path
  assertEquals(plan.pending, []);
  assertEquals(plan.tracked, [
    { package: "a", currentVersion: "1.0.0", path: "packages/a" },
    { package: "b", currentVersion: "0.4.2", path: "packages/b" },
    { package: "c", currentVersion: "2.1.0", path: "packages/c" },
  ]);
});

Deno.test("buildVersionPlan keeps `tracked` populated even when packages bump", () => {
  // Given a package with a pending record alongside other packages that
  // don't have records
  const discoveredPackages = [
    buildPackage("alpha", "packages/alpha"),
    buildPackage("beta", "packages/beta"),
  ];
  const parsedRecords: DvRecord[] = [buildRecord("a.md", "feat", ["alpha"])];
  const packageCurrentVersions = [
    packageVersion("alpha", "1.0.0"),
    packageVersion("beta", "2.0.0"),
  ];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "version",
    discoveredPackages,
    parsedRecords,
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then `tracked` lists both packages (independent of `pending`)
  assertEquals(plan.pending.length, 1);
  assertEquals(plan.pending[0]?.package, "alpha");
  assertEquals(plan.tracked, [
    { package: "alpha", currentVersion: "1.0.0", path: "packages/alpha" },
    { package: "beta", currentVersion: "2.0.0", path: "packages/beta" },
  ]);
});

Deno.test("buildVersionPlan omits packages from `tracked` when no current version was resolved", () => {
  // Given a discovered package whose read-version was not run (no entry
  // in packageCurrentVersions) — e.g. the plugin failed for that one
  const discoveredPackages = [
    buildPackage("ok", "packages/ok"),
    buildPackage("missing", "packages/missing"),
  ];
  const packageCurrentVersions = [packageVersion("ok", "1.0.0")];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords: [],
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then only the package with a known version appears in `tracked`
  assertEquals(plan.tracked, [
    { package: "ok", currentVersion: "1.0.0", path: "packages/ok" },
  ]);
});

Deno.test("buildVersionPlan keeps awaitingRelease empty when no lookup is provided (back-compat default)", () => {
  // Given a fixture with no awaitingReleaseLookup arg
  const discoveredPackages = [buildPackage("core", "packages/core")];
  const packageCurrentVersions = [packageVersion("core", "1.0.0")];

  // When the plan is built
  const plan = buildVersionPlan({
    command: "status",
    discoveredPackages,
    parsedRecords: [],
    renameLedger: [],
    packageCurrentVersions,
  });

  // Then awaitingRelease stays empty — the absent arg means "the
  // caller did not ask about release state"; we don't fabricate it
  assertEquals(plan.awaitingRelease, []);
});

Deno.test("buildVersionPlan copies awaitingReleaseLookup into the Plan, sorted by package", () => {
  // Given a lookup the caller pre-computed in arbitrary order
  const discoveredPackages = [
    buildPackage("alpha", "packages/alpha"),
    buildPackage("beta", "packages/beta"),
  ];
  const packageCurrentVersions = [
    packageVersion("alpha", "1.0.0"),
    packageVersion("beta", "0.4.2"),
  ];

  // When the plan is built with both packages awaiting release
  const plan = buildVersionPlan({
    command: "release",
    discoveredPackages,
    parsedRecords: [],
    renameLedger: [],
    packageCurrentVersions,
    awaitingReleaseLookup: [
      {
        package: "beta",
        version: "0.4.2",
        tag: "beta@0.4.2",
        firstStable: false,
      },
      {
        package: "alpha",
        version: "1.0.0",
        tag: "alpha@1.0.0",
        firstStable: true,
      },
    ],
  });

  // Then both entries appear, sorted by package name (alpha before
  // beta) — byte-stable JSON across runs
  assertEquals(plan.awaitingRelease.length, 2);
  assertEquals(plan.awaitingRelease[0]?.package, "alpha");
  assertEquals(plan.awaitingRelease[0]?.firstStable, true);
  assertEquals(plan.awaitingRelease[1]?.package, "beta");
  assertEquals(plan.awaitingRelease[1]?.firstStable, false);
});
