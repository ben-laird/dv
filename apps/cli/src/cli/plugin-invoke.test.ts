import { assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import { DvError } from "../domain/errors.ts";
import { runPluginInvoke } from "./plugin-invoke.ts";

// Integration tests for `dv plugin invoke`. We drive the real
// examples/plugins/deno/main.ts (the same dispatcher the rest of
// the integration suite dogfoods), so any drift in the plugin
// contract surfaces here too — invoke + verify are the
// contract-test surface, not a parallel mock.

interface SetUpRepoArgs {
  // The package fixture(s) to scaffold. Each gets a deno.json with
  // {name, version} so the plugin's read-version op can find them.
  packages?: { name: string; path: string; version: string }[];
}

interface RepoFixture {
  repoRootPath: string;
  pluginInvocation: string;
  cleanup: () => Promise<void>;
}

async function setUpRepo(args: SetUpRepoArgs): Promise<RepoFixture> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-plugin-invoke-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);

  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();

  const thisFileDir = fromFileUrl(new URL(".", import.meta.url));
  const realPluginMainPath = resolve(
    thisFileDir,
    "../../../../examples/plugins/deno/main.ts",
  );

  for (const pkg of args.packages ?? []) {
    const packageDir = join(repoRootPath, pkg.path);
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(
      join(packageDir, "deno.json"),
      `${JSON.stringify({ name: pkg.name, version: pkg.version }, null, 2)}\n`,
    );
  }

  return {
    repoRootPath,
    pluginInvocation: `run:deno run -A ${realPluginMainPath}`,
    cleanup: async () => {
      Deno.chdir(previousWorkingDirectory);
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

async function silenceStdout<T>(action: () => Promise<T>): Promise<T> {
  const originalConsoleLog = console.log;
  console.log = () => {};
  try {
    return await action();
  } finally {
    console.log = originalConsoleLog;
  }
}

Deno.test("runPluginInvoke runs `discover` against the real example plugin and conformance-checks the response", async () => {
  // Given a single discoverable package and the real example plugin
  const fixture = await setUpRepo({
    packages: [{ name: "pkg-a", path: "packages/pkg-a", version: "1.0.0" }],
  });
  try {
    // When `dv plugin invoke <real plugin> discover --glob packages/*` runs
    const result = await silenceStdout(() =>
      runPluginInvoke({
        pluginPositional: fixture.pluginInvocation,
        opName: "discover",
        discoverGlob: "packages/*",
        repoRoot: fixture.repoRootPath,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the conformance check passes and the parsed response
    // contains the expected package
    assertEquals(result.conformant, true);
    assertEquals(result.opName, "discover");
    const parsed = result.parsedResponse as {
      packages: { name: string; path: string }[];
    };
    assertEquals(parsed.packages.length, 1);
    assertEquals(parsed.packages[0]?.name, "pkg-a");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runPluginInvoke runs `read-version` and returns the parsed version", async () => {
  // Given a package whose manifest carries version 2.3.4
  const fixture = await setUpRepo({
    packages: [{ name: "pkg-a", path: "packages/pkg-a", version: "2.3.4" }],
  });
  try {
    // When `dv plugin invoke <real plugin> read-version --package pkg-a --path packages/pkg-a` runs
    const result = await silenceStdout(() =>
      runPluginInvoke({
        pluginPositional: fixture.pluginInvocation,
        opName: "read-version",
        packageName: "pkg-a",
        packagePath: join(fixture.repoRootPath, "packages/pkg-a"),
        repoRoot: fixture.repoRootPath,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the conformance check passes and the version matches
    assertEquals(result.conformant, true);
    const parsed = result.parsedResponse as { version: string };
    assertEquals(parsed.version, "2.3.4");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runPluginInvoke rejects discover without --glob (DV_DISCOVER_GLOB is required by the contract)", async () => {
  const fixture = await setUpRepo({});
  try {
    // When discover is invoked without --glob
    // Then a DvError surfaces before any plugin process spawns
    const caughtError = await assertRejects(
      () =>
        runPluginInvoke({
          pluginPositional: fixture.pluginInvocation,
          opName: "discover",
          repoRoot: fixture.repoRootPath,
          emitJson: false,
          colorEnabled: false,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "plugin-bad-response");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runPluginInvoke rejects read-version without --package + --path", async () => {
  const fixture = await setUpRepo({});
  try {
    // When read-version runs with only --package
    // Then the missing --path is reported before any process spawns
    const caughtError = await assertRejects(
      () =>
        runPluginInvoke({
          pluginPositional: fixture.pluginInvocation,
          opName: "read-version",
          packageName: "pkg-a",
          repoRoot: fixture.repoRootPath,
          emitJson: false,
          colorEnabled: false,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "plugin-bad-response");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runPluginInvoke threads --trigger and --bumped-packages through to the finalize env vars", async () => {
  // Regression: an earlier dispatcher dropped these two options on
  // the floor when constructing the child env, so finalize always
  // saw DV_FINALIZE_TRIGGER='version' and DV_BUMPED_PACKAGES='[]'
  // regardless of what the user passed. The plugin then either
  // refused to refresh the right lockfile or no-op'd the run.
  const fixture = await setUpRepo({
    packages: [{ name: "pkg-a", path: "packages/pkg-a", version: "1.0.0" }],
  });
  try {
    const bumpedPackagesJson = JSON.stringify([
      { name: "pkg-a", path: "packages/pkg-a", new_version: "1.1.0" },
    ]);
    const result = await silenceStdout(() =>
      runPluginInvoke({
        pluginPositional: fixture.pluginInvocation,
        opName: "finalize",
        repoRoot: fixture.repoRootPath,
        finalizeTrigger: "v1",
        bumpedPackagesJson,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the env captured for the child process reflects what
    // the user supplied — not the defaults.
    assertEquals(result.environmentVariables.DV_FINALIZE_TRIGGER, "v1");
    assertEquals(
      result.environmentVariables.DV_BUMPED_PACKAGES,
      bumpedPackagesJson,
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runPluginInvoke rejects update-dependency without --stdin-json", async () => {
  const fixture = await setUpRepo({
    packages: [{ name: "pkg-a", path: "packages/pkg-a", version: "1.0.0" }],
  });
  try {
    // When update-dependency runs with no stdin payload
    // Then the contract violation is caught pre-spawn
    const caughtError = await assertRejects(
      () =>
        runPluginInvoke({
          pluginPositional: fixture.pluginInvocation,
          opName: "update-dependency",
          packageName: "pkg-a",
          packagePath: join(fixture.repoRootPath, "packages/pkg-a"),
          repoRoot: fixture.repoRootPath,
          emitJson: false,
          colorEnabled: false,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "plugin-bad-response");
  } finally {
    await fixture.cleanup();
  }
});
