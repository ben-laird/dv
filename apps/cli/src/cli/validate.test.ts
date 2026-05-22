import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runValidate } from "./validate.ts";

interface SetUpRepoArgs {
  pluginDiscoverScript: string;
  recordFiles?: globalThis.Record<string, string>;
  renamesYaml?: string;
}

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoForValidate(
  args: SetUpRepoArgs,
): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-validate-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);
  const gitInitResult = await new Deno.Command("git", {
    args: ["init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");

  const configDir = join(repoRootPath, ".changelog");
  const recordsDir = join(configDir, "records");
  await Deno.mkdir(recordsDir, { recursive: true });
  await Deno.writeTextFile(
    join(configDir, "config.yaml"),
    `discovery:
  plugins:
    - match: "packages/*"
      use: ./plugin
`,
  );

  const pluginPath = join(repoRootPath, "plugin");
  await Deno.writeTextFile(
    pluginPath,
    `#!/usr/bin/env bash
set -euo pipefail
${args.pluginDiscoverScript}
`,
  );
  await Deno.chmod(pluginPath, 0o755);

  for (const [recordFilename, recordContents] of Object.entries(
    args.recordFiles ?? {},
  )) {
    await Deno.writeTextFile(join(recordsDir, recordFilename), recordContents);
  }
  if (args.renamesYaml !== undefined) {
    await Deno.writeTextFile(join(configDir, "renames.yaml"), args.renamesYaml);
  }

  return {
    repoRootPath,
    cleanup: async () => {
      Deno.chdir(previousWorkingDirectory);
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

const NOOP_VALIDATE_OPTIONS = { emitJson: true, colorEnabled: false };

Deno.test("runValidate reports ok with zero problems when records are well-formed", async () => {
  // Given a repo with one well-formed Record referencing a discovered Package
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`,
    recordFiles: {
      "happy-record.md": `---
type: feat
packages: [core]
---

A real change.
`,
    },
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then the report carries ok=true with no problems
    assertEquals(validateResult.report.ok, true);
    assertEquals(validateResult.report.problems, []);
    assertEquals(validateResult.report.recordsChecked, 1);
    assertEquals(validateResult.exitCode, 0);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate flags an unresolved-reference for an unknown package", async () => {
  // Given a Record referencing a Package the plugin doesn't discover
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`,
    recordFiles: {
      "bad-record.md": `---
type: feat
packages: [ghost]
---

Refers to a package that isn't here.
`,
    },
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then the report flags the reference with the unresolved-reference code
    assertEquals(validateResult.report.ok, false);
    assertEquals(validateResult.exitCode, 1);
    assertEquals(validateResult.report.problems.length, 1);
    assertEquals(
      validateResult.report.problems[0]?.code,
      "unresolved-reference",
    );
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate accepts a reference that resolves through the rename ledger", async () => {
  // Given a Record using an old package name that the rename ledger maps
  // to a currently-discovered Package
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: `echo '{"packages":[{"name":"engine","path":"packages/engine"}]}'`,
    recordFiles: {
      "old-name-record.md": `---
type: fix
packages: [core]
---

Uses the old name.
`,
    },
    renamesYaml: `- from: core
  to: engine
  at: 1.0.0
`,
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then no problem is reported (rename closure resolved the reference)
    assertEquals(validateResult.report.ok, true);
    assertEquals(validateResult.report.problems, []);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate aggregates problems instead of bailing on the first", async () => {
  // Given two records that are bad in different ways
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`,
    recordFiles: {
      "shape-bad.md": `---
type: chore
packages: [core]
---

bad type
`,
      "ref-bad.md": `---
type: feat
packages: [ghost]
---

bad reference
`,
    },
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then both problems land in the report
    assertEquals(validateResult.report.ok, false);
    assertEquals(validateResult.report.problems.length, 2);
  } finally {
    await repo.cleanup();
  }
});
