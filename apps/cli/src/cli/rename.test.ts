import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import { DvError } from "../domain/errors.ts";
import { runRename } from "./rename.ts";

// Integration tests for `dv rename`. Two paths to exercise:
//   - `--at` override: skips discovery entirely, so we don't need a
//     real plugin pipeline. Smaller, faster, covers the writer wiring.
//   - inferred `at`: discovers the new package via the real
//     examples/plugins/deno main.ts (the same dispatcher all the
//     other integration tests dogfood against). Covers the
//     read-version inference path.
//
// We also check that `loadRenameLedger` round-trips the appended
// entry (the resolver path consumed by add/version/v1).

interface SetUpRepoArgs {
  // Initial ledger contents, if any. Pass undefined for the "first
  // rename in this repo" case.
  existingLedgerYaml?: string;
  // If provided, scaffold a single discoverable package at
  // packages/<packageName>/deno.json with this version. Used by the
  // inferred-at path test.
  discoverablePackage?: { name: string; version: string };
}

interface RepoFixture {
  repoRootPath: string;
  ledgerPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepo(args: SetUpRepoArgs): Promise<RepoFixture> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-rename-cli-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);

  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();

  const dvDir = join(repoRootPath, ".dv");
  await Deno.mkdir(dvDir, { recursive: true });

  // Minimum viable config so `loadConfig` and `discoverPackages` work
  // when the test exercises the inference path; the override path
  // never reads it but a present config is harmless.
  const thisFileDir = fromFileUrl(new URL(".", import.meta.url));
  const realPluginMainPath = resolve(
    thisFileDir,
    "../../../../examples/plugins/deno/main.ts",
  );
  await Deno.writeTextFile(
    join(dvDir, "config.yaml"),
    `discovery:
  plugins:
    - match: "packages/*"
      use:
        run: deno run -A ${realPluginMainPath}
`,
  );

  if (args.existingLedgerYaml !== undefined) {
    await Deno.writeTextFile(
      join(dvDir, "renames.yaml"),
      args.existingLedgerYaml,
    );
  }

  if (args.discoverablePackage !== undefined) {
    const packageDir = join(
      repoRootPath,
      "packages",
      args.discoverablePackage.name,
    );
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(
      join(packageDir, "deno.json"),
      `${JSON.stringify(
        {
          name: args.discoverablePackage.name,
          version: args.discoverablePackage.version,
        },
        null,
        2,
      )}\n`,
    );
  }

  return {
    repoRootPath,
    ledgerPath: join(dvDir, "renames.yaml"),
    cleanup: async () => {
      Deno.chdir(previousWorkingDirectory);
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

async function captureStdout<T>(action: () => Promise<T>): Promise<{
  result: T;
  capturedStdout: string;
}> {
  const originalConsoleLog = console.log;
  const collected: string[] = [];
  console.log = (...parts: unknown[]) => {
    collected.push(parts.map((p) => String(p)).join(" "));
  };
  try {
    const result = await action();
    return { result, capturedStdout: collected.join("\n") };
  } finally {
    console.log = originalConsoleLog;
  }
}

Deno.test("runRename with --at writes a new ledger entry from scratch", async () => {
  // Given an empty repo (no existing ledger, no discoverable
  // package) — `--at` skips the discovery requirement, which is
  // exactly its reason for existing
  const fixture = await setUpRepo({});
  try {
    // When `dv rename core engine --at 1.3.0` runs
    const { result, capturedStdout } = await captureStdout(() =>
      runRename({
        fromPackageName: "core",
        toPackageName: "engine",
        atVersionOverride: "1.3.0",
        dryRun: false,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the result reports the override source, the file is
    // newly created, and the human summary names both packages
    assertEquals(result.fromPackageName, "core");
    assertEquals(result.toPackageName, "engine");
    assertEquals(result.atVersion, "1.3.0");
    assertEquals(result.atVersionSource, "override");
    assertEquals(result.fileCreated, true);
    assertEquals(result.fileWritten, true);
    assertStringIncludes(capturedStdout, "core");
    assertStringIncludes(capturedStdout, "engine");
    assertStringIncludes(capturedStdout, "1.3.0");

    // And the written ledger is loadable as a single entry
    const ledgerText = await Deno.readTextFile(fixture.ledgerPath);
    assertStringIncludes(ledgerText, "from: core");
    assertStringIncludes(ledgerText, "to: engine");
    assertStringIncludes(ledgerText, "1.3.0");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRename in --dry-run mode reports the planned entry without writing", async () => {
  // Given the same empty repo
  const fixture = await setUpRepo({});
  try {
    // When dry-run is set
    const { result } = await captureStdout(() =>
      runRename({
        fromPackageName: "core",
        toPackageName: "engine",
        atVersionOverride: "1.3.0",
        dryRun: true,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the result reports a planned (not written) append, and
    // the ledger file does not exist on disk
    assertEquals(result.fileWritten, false);
    await assertRejects(
      () => Deno.readTextFile(fixture.ledgerPath),
      Deno.errors.NotFound,
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRename refuses to add a duplicate `from` edge", async () => {
  // Given an existing ledger that already maps `core → engine`
  const fixture = await setUpRepo({
    existingLedgerYaml: "- from: core\n  to: engine\n  at: 1.3.0\n",
  });
  try {
    // When `dv rename core kernel --at 2.0.0` runs
    // Then a DvError surfaces with code `ledger-duplicate-edge`
    // and the ledger is untouched
    const caughtError = await assertRejects(
      () =>
        runRename({
          fromPackageName: "core",
          toPackageName: "kernel",
          atVersionOverride: "2.0.0",
          dryRun: false,
          emitJson: false,
          colorEnabled: false,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "ledger-duplicate-edge");

    const ledgerText = await Deno.readTextFile(fixture.ledgerPath);
    // The original entry remains; no `kernel` line was added
    assertEquals(ledgerText.includes("kernel"), false);
    assertStringIncludes(ledgerText, "to: engine");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRename infers `at` from discovery when no override is supplied", async () => {
  // Given a discoverable package `engine@1.3.0` (the rename target)
  // — the user has already renamed core → engine in their manifest,
  // and we infer the ledger's `at` from the current version
  const fixture = await setUpRepo({
    discoverablePackage: { name: "engine", version: "1.3.0" },
  });
  try {
    // When `dv rename core engine` runs without --at
    const { result } = await captureStdout(() =>
      runRename({
        fromPackageName: "core",
        toPackageName: "engine",
        dryRun: false,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the inferred version is the package's current version,
    // tagged as "inferred"
    assertEquals(result.atVersion, "1.3.0");
    assertEquals(result.atVersionSource, "inferred");

    const ledgerText = await Deno.readTextFile(fixture.ledgerPath);
    assertStringIncludes(ledgerText, "to: engine");
    assertStringIncludes(ledgerText, "1.3.0");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRename errors when inference is requested but the new package is not discoverable", async () => {
  // Given no discoverable package matching `<new>` — the user
  // either misspelled it or hasn't actually renamed the package
  // yet. We want a clear error pointing at the --at escape hatch.
  const fixture = await setUpRepo({});
  try {
    const caughtError = await assertRejects(
      () =>
        runRename({
          fromPackageName: "core",
          toPackageName: "engine",
          dryRun: false,
          emitJson: false,
          colorEnabled: false,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "v1-package-not-found");
  } finally {
    await fixture.cleanup();
  }
});
