import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../domain/errors.ts";
import { runMigrateConfig } from "./migrate.ts";

// Integration tests for `dv migrate config`. Real git repo + real
// .dv/config.yaml on disk, exercising the file IO path that the
// subtool's pure-text tests don't.

interface SetUpMigrateFixtureArgs {
  // The YAML content to scaffold under .dv/config.yaml. Tests
  // pass in either a legacy-form or current-form config to
  // exercise the corresponding code path.
  configYaml: string;
}

interface MigrateFixtureResult {
  repoRootPath: string;
  configFilePath: string;
  cleanup: () => Promise<void>;
}

async function setUpFixture(
  args: SetUpMigrateFixtureArgs,
): Promise<MigrateFixtureResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-migrate-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);

  const gitInitResult = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");

  const dvDir = join(repoRootPath, ".dv");
  await Deno.mkdir(dvDir, { recursive: true });
  const configFilePath = join(dvDir, "config.yaml");
  await Deno.writeTextFile(configFilePath, args.configYaml);

  return {
    repoRootPath,
    configFilePath,
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

Deno.test("runMigrateConfig rewrites a legacy config in place and reports the changes", async () => {
  // Given a legacy-form config on disk
  const fixture = await setUpFixture({
    configYaml: `discovery:
  plugins:
    - match: "apps/*"
      use: ./examples/plugins/deno
`,
  });

  try {
    // When dv migrate config runs (real run, not dry)
    const { result } = await captureStdout(() =>
      runMigrateConfig({
        dryRun: false,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the file was written and contains the discriminated form
    assertEquals(result.fileWritten, true);
    assertEquals(result.alreadyMigrated, false);
    assertEquals(result.stepResults.length, 1);
    assertEquals(result.stepResults[0]?.changes.length, 1);

    const rewrittenContent = await Deno.readTextFile(fixture.configFilePath);
    assertStringIncludes(
      rewrittenContent,
      "use:\n        path: ./examples/plugins/deno",
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runMigrateConfig --dry-run reports the changes without writing the file", async () => {
  // Given a legacy-form config on disk
  const fixture = await setUpFixture({
    configYaml: `discovery:
  plugins:
    - match: "apps/*"
      use: ./plugin
`,
  });

  try {
    // When dv migrate config runs in dry-run mode
    const { result } = await captureStdout(() =>
      runMigrateConfig({
        dryRun: true,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the file is unchanged (dry-run is zero-side-effects)
    // but the change list is fully populated for the human
    // summary's benefit
    assertEquals(result.fileWritten, false);
    assertEquals(result.stepResults[0]?.changes.length, 1);
    const stillLegacy = await Deno.readTextFile(fixture.configFilePath);
    assertStringIncludes(stillLegacy, "use: ./plugin");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runMigrateConfig is a friendly no-op on an already-migrated config", async () => {
  // Given a config already in the current discriminated shape
  const fixture = await setUpFixture({
    configYaml: `discovery:
  plugins:
    - match: "apps/*"
      use:
        path: ./examples/plugins/deno
`,
  });

  try {
    // When dv migrate config runs
    const { result, capturedStdout } = await captureStdout(() =>
      runMigrateConfig({
        dryRun: false,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the result signals alreadyMigrated, the file is not
    // touched, and the human output reads as a friendly no-op
    assertEquals(result.alreadyMigrated, true);
    assertEquals(result.fileWritten, false);
    assertEquals(result.stepResults, []);
    assertStringIncludes(capturedStdout, "nothing to migrate");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runMigrateConfig emits a parseable JSON envelope under --json", async () => {
  // Given a legacy-form config
  const fixture = await setUpFixture({
    configYaml: `discovery:
  plugins:
    - match: "apps/*"
      use: ./plugin
publishing:
  plugin: ./release
`,
  });

  try {
    // When dv migrate config runs with --json
    const { capturedStdout } = await captureStdout(() =>
      runMigrateConfig({
        dryRun: true,
        emitJson: true,
        colorEnabled: false,
      }),
    );

    // Then stdout carries the v1 envelope with the structured
    // step results — consumers shouldn't need to scrape the
    // human summary
    const parsed = JSON.parse(capturedStdout) as {
      schema: string;
      alreadyMigrated: boolean;
      stepResults: { stepId: string; changes: { path: string }[] }[];
      fileWritten: boolean;
    };
    assertEquals(parsed.schema, "urn:dv:schema:v1:migrate-config-result");
    assertEquals(parsed.alreadyMigrated, false);
    assertEquals(parsed.stepResults.length, 1);
    // The single step's two changes (use + publishing.plugin)
    // both ride along under the same step's `changes` array
    assertEquals(parsed.stepResults[0]?.changes.length, 2);
    assertEquals(parsed.fileWritten, false);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runMigrateConfig surfaces config-not-found when there's no .dv/config.yaml", async () => {
  // Given a git repo with no .dv/config.yaml
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-migrate-empty-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();

  try {
    // When dv migrate config runs
    // Then DvError surfaces with the standard config-not-found
    // code, same as every other command that reads the config
    const caughtError = await assertRejects(
      () =>
        runMigrateConfig({
          dryRun: false,
          emitJson: false,
          colorEnabled: false,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "config-not-found");
  } finally {
    Deno.chdir(previousWorkingDirectory);
    await Deno.remove(repoRootPath, { recursive: true });
  }
});
