import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runAdd } from "./add.ts";

// Integration tests for the non-interactive flag-driven path of `dv add`.
// The interactive flow opens `$EDITOR` and uses raw-mode stdin, which is
// awkward to drive from a test; we cover the orchestration via flags-
// only and dogfood the interactive flow manually with `dv add`.

interface SetUpRepoArgs {
  configYaml?: string;
  pluginDiscoverScript: string;
}

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoWithPlugin(
  args: SetUpRepoArgs,
): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-add-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);
  const gitInitResult = await new Deno.Command("git", {
    args: ["init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");

  const configDir = join(repoRootPath, ".changelog");
  await Deno.mkdir(configDir, { recursive: true });
  const configYaml =
    args.configYaml ??
    `discovery:
  plugins:
    - match: "packages/*"
      use: ./plugin
`;
  await Deno.writeTextFile(join(configDir, "config.yaml"), configYaml);

  const pluginPath = join(repoRootPath, "plugin");
  await Deno.writeTextFile(
    pluginPath,
    `#!/usr/bin/env bash
set -euo pipefail
${args.pluginDiscoverScript}
`,
  );
  await Deno.chmod(pluginPath, 0o755);

  return {
    repoRootPath,
    cleanup: async () => {
      Deno.chdir(previousWorkingDirectory);
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

Deno.test("runAdd creates a Record file with the supplied fields", async () => {
  // Given a temp repo whose plugin discovers one Package
  const repo = await setUpRepoWithPlugin({
    pluginDiscoverScript: `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`,
  });
  try {
    // When runAdd is called with full flag inputs
    const addResult = await runAdd({
      changeType: "feat",
      packageNames: ["core"],
      message: "Add a thing.",
      stageOverride: false, // skip `git add` so the test is hermetic
    });

    // Then a Record file lands in .changelog/records/ with the inputs in frontmatter
    const writtenContents = await Deno.readTextFile(addResult.recordPath);
    assertStringIncludes(writtenContents, "type: feat");
    assertStringIncludes(writtenContents, "core");
    assertStringIncludes(writtenContents, "Add a thing.");
    assertEquals(addResult.staged, false);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runAdd rejects unknown package references", async () => {
  // Given a temp repo whose plugin discovers `core` only
  const repo = await setUpRepoWithPlugin({
    pluginDiscoverScript: `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`,
  });
  try {
    // When runAdd is called with a package name that doesn't exist
    // Then runAdd rejects with add-unknown-package
    await assertRejects(
      () =>
        runAdd({
          changeType: "fix",
          packageNames: ["mystery"],
          message: "irrelevant",
          stageOverride: false,
        }),
      Error,
      "unknown package",
    );
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runAdd resolves package references through .changelog/renames.yaml", async () => {
  // Given a repo where the current Package is `engine` but the user
  // still refers to its old name `core` via the rename ledger
  const repo = await setUpRepoWithPlugin({
    pluginDiscoverScript: `echo '{"packages":[{"name":"engine","path":"packages/engine"}]}'`,
  });
  try {
    await Deno.writeTextFile(
      join(repo.repoRootPath, ".changelog", "renames.yaml"),
      `- from: core
  to: engine
  at: 1.0.0
`,
    );

    // When runAdd is called with the old name
    const addResult = await runAdd({
      changeType: "fix",
      packageNames: ["core"],
      message: "Use the legacy name.",
      stageOverride: false,
    });

    // Then the Record is written successfully (the resolver accepted the rename)
    const writtenContents = await Deno.readTextFile(addResult.recordPath);
    assertStringIncludes(writtenContents, "type: fix");
    assertStringIncludes(writtenContents, "core");
  } finally {
    await repo.cleanup();
  }
});
