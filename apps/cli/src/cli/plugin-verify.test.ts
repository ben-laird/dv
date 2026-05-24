import { assertEquals } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import { runPluginVerify } from "./plugin-verify.ts";

// Integration tests for `dv plugin verify` against the real example
// plugin. The verifier's contract:
//   - discover passes against a sane glob
//   - read-version passes for each discovered package
//   - side-effectful ops are reported as skipped (not run)
//   - the bogus-op check passes (the plugin exits non-zero on
//     unknown op names, per the contract)

interface SetUpRepoArgs {
  packages?: { name: string; path: string; version: string }[];
}

interface RepoFixture {
  repoRootPath: string;
  pluginInvocation: string;
  cleanup: () => Promise<void>;
}

async function setUpRepo(args: SetUpRepoArgs): Promise<RepoFixture> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-plugin-verify-" });
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

Deno.test("runPluginVerify reports PASS against the example deno plugin with a discoverable package", async () => {
  // Given a fixture with a real package the example plugin can
  // discover + read-version
  const fixture = await setUpRepo({
    packages: [{ name: "pkg-a", path: "packages/pkg-a", version: "1.0.0" }],
  });
  try {
    // When verify runs against the real plugin
    const result = await silenceStdout(() =>
      runPluginVerify({
        pluginPositional: fixture.pluginInvocation,
        repoRoot: fixture.repoRootPath,
        discoverGlob: "packages/*",
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then nothing fails, side-effectful ops are skipped, and the
    // bogus-op check is one of the passes
    assertEquals(result.failedCount, 0);
    const discoverCheck = result.checks.find((c) => c.name === "discover");
    assertEquals(discoverCheck?.outcome, "pass");
    const readVersionCheck = result.checks.find((c) =>
      c.name.startsWith("read-version["),
    );
    assertEquals(readVersionCheck?.outcome, "pass");
    const writeVersionCheck = result.checks.find(
      (c) => c.name === "write-version",
    );
    assertEquals(writeVersionCheck?.outcome, "skipped");
    const badInputCheck = result.checks.find(
      (c) => c.name === "bad-input rejects",
    );
    assertEquals(badInputCheck?.outcome, "pass");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runPluginVerify reports read-version as skipped when discover returns no packages", async () => {
  // Given a fixture with no packages — discover succeeds (empty
  // list), which means read-version has nothing to exercise
  const fixture = await setUpRepo({});
  try {
    const result = await silenceStdout(() =>
      runPluginVerify({
        pluginPositional: fixture.pluginInvocation,
        repoRoot: fixture.repoRootPath,
        discoverGlob: "packages/*",
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then discover passes (returned 0 packages, but conformant),
    // read-version is skipped with a helpful hint, and the verdict
    // is still PASS overall
    assertEquals(result.failedCount, 0);
    const discoverCheck = result.checks.find((c) => c.name === "discover");
    assertEquals(discoverCheck?.outcome, "pass");
    const readVersionCheck = result.checks.find(
      (c) => c.name === "read-version",
    );
    assertEquals(readVersionCheck?.outcome, "skipped");
  } finally {
    await fixture.cleanup();
  }
});
