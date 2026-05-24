import { assertEquals } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import { runPluginList } from "./plugin-list.ts";

// Integration tests for `dv plugin list`. The audit walks every
// plugin assignment in the config, resolves each one, runs its
// per-assignment discovery, and reports either the claimed
// packages or a non-fatal error row. We exercise:
//   - happy path: one working plugin with packages
//   - non-fatal failure: a broken plugin reference produces a
//     row, the result reports `hasFailures`, and any later
//     working plugin still shows up.

interface SetUpRepoArgs {
  configYaml: string;
  packages?: { name: string; path: string; version: string }[];
}

interface RepoFixture {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepo(args: SetUpRepoArgs): Promise<RepoFixture> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-plugin-list-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);

  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();

  const dvDir = join(repoRootPath, ".dv");
  await Deno.mkdir(dvDir, { recursive: true });
  await Deno.writeTextFile(join(dvDir, "config.yaml"), args.configYaml);

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

function realPluginRunInvocation(): string {
  const thisFileDir = fromFileUrl(new URL(".", import.meta.url));
  const realPluginMainPath = resolve(
    thisFileDir,
    "../../../../examples/plugins/deno/main.ts",
  );
  return `deno run -A ${realPluginMainPath}`;
}

Deno.test("runPluginList lists each plugin with its claimed packages on the happy path", async () => {
  // Given a config with one working plugin and one discoverable
  // package
  const fixture = await setUpRepo({
    configYaml: `discovery:
  plugins:
    - match: "packages/*"
      use:
        run: ${realPluginRunInvocation()}
`,
    packages: [{ name: "pkg-a", path: "packages/pkg-a", version: "1.0.0" }],
  });
  try {
    // When `dv plugin list` runs
    const result = await silenceStdout(() =>
      runPluginList({ emitJson: false, colorEnabled: false }),
    );

    // Then the single entry reports `ok` with the discovered package
    assertEquals(result.entries.length, 1);
    assertEquals(result.entries[0]?.status, "ok");
    assertEquals(result.entries[0]?.packages.length, 1);
    assertEquals(result.entries[0]?.packages[0]?.name, "pkg-a");
    assertEquals(result.hasFailures, false);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runPluginList reports a non-fatal `resolve-failed` row for a broken plugin reference but still discovers the working one", async () => {
  // Given a config with two plugins: the first points at a path
  // that doesn't exist, the second is the real example plugin
  const fixture = await setUpRepo({
    configYaml: `discovery:
  plugins:
    - match: "broken/*"
      use:
        path: ./does-not-exist
    - match: "packages/*"
      use:
        run: ${realPluginRunInvocation()}
`,
    packages: [{ name: "pkg-a", path: "packages/pkg-a", version: "1.0.0" }],
  });
  try {
    // When `dv plugin list` runs
    const result = await silenceStdout(() =>
      runPluginList({ emitJson: false, colorEnabled: false }),
    );

    // Then both entries appear: the first as `resolve-failed`,
    // the second as `ok` with its packages, and `hasFailures` is true
    assertEquals(result.entries.length, 2);
    assertEquals(result.entries[0]?.status, "resolve-failed");
    assertEquals(result.entries[0]?.errorCode, "plugin-not-found");
    assertEquals(result.entries[1]?.status, "ok");
    assertEquals(result.entries[1]?.packages[0]?.name, "pkg-a");
    assertEquals(result.hasFailures, true);
  } finally {
    await fixture.cleanup();
  }
});
