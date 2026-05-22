import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../domain/errors.ts";
import { runVersion } from "./version.ts";

// Integration tests for `dv version` against temp git repos. Each
// fixture sets up a real git working tree with a shell plugin that
// implements `discover`, `read-version`, and `write-version`, and a
// `.changelog/` directory the test populates.

interface SetUpRepoArgs {
  configYaml?: string;
  recordFiles?: Record<string, string>;
  // The current version the plugin will report for the "core" package
  // before dv version runs.
  initialVersion?: string;
}

interface SetUpRepoResult {
  repoRootPath: string;
  versionFilePath: string;
  changelogPath: string;
  cleanup: () => Promise<void>;
}

async function setUpFixture(args: SetUpRepoArgs): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-version-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);

  const gitInitResult = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");
  await new Deno.Command("git", {
    args: [
      "-C",
      repoRootPath,
      "config",
      "user.email",
      "dv-test@example.invalid",
    ],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "user.name", "dv test"],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "commit.gpgsign", "false"],
  }).output();

  const changelogDir = join(repoRootPath, ".changelog");
  await Deno.mkdir(changelogDir, { recursive: true });
  const configYaml =
    args.configYaml ??
    `discovery:
  plugins:
    - match: "packages/*"
      use: ./plugin
`;
  await Deno.writeTextFile(join(changelogDir, "config.yaml"), configYaml);

  const recordsDir = join(changelogDir, "records");
  await Deno.mkdir(recordsDir, { recursive: true });
  for (const [recordFilename, recordContents] of Object.entries(
    args.recordFiles ?? {},
  )) {
    await Deno.writeTextFile(join(recordsDir, recordFilename), recordContents);
  }

  // The "core" package lives at packages/core/ and stores its version in
  // a plain VERSION file. The shell plugin reads/writes that file.
  const packageDir = join(repoRootPath, "packages", "core");
  await Deno.mkdir(packageDir, { recursive: true });
  const versionFilePath = join(packageDir, "VERSION");
  await Deno.writeTextFile(
    versionFilePath,
    `${args.initialVersion ?? "1.4.2"}\n`,
  );

  const pluginPath = join(repoRootPath, "plugin");
  await Deno.writeTextFile(
    pluginPath,
    `#!/usr/bin/env bash
set -euo pipefail
case "\${DV_OPERATION:-$1}" in
  discover)
    echo '{"packages":[{"name":"core","path":"packages/core"}]}'
    ;;
  read-version)
    version=$(cat "$DV_PACKAGE_PATH/VERSION")
    printf '{"version":"%s"}\\n' "$version"
    ;;
  write-version)
    echo "$DV_NEW_VERSION" > "$DV_PACKAGE_PATH/VERSION"
    echo '{"ok":true}'
    ;;
esac
`,
  );
  await Deno.chmod(pluginPath, 0o755);

  // Make the initial state committable so require-clean-tree passes.
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "add", "."],
  }).output();
  await new Deno.Command("git", {
    args: [
      "-C",
      repoRootPath,
      "commit",
      "-m",
      "initial",
      "--no-gpg-sign",
      "-q",
    ],
  }).output();

  return {
    repoRootPath,
    versionFilePath,
    changelogPath: join(packageDir, "CHANGELOG.md"),
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

Deno.test("runVersion --dry-run prints the plan without touching disk or invoking write-version", async () => {
  // Given a repo with one feat record on the core package
  const fixture = await setUpFixture({
    initialVersion: "1.4.2",
    recordFiles: {
      "a.md": "---\ntype: feat\npackages:\n  - core\n---\n\nAdd a feature.\n",
    },
  });

  try {
    // When dv version runs with --dry-run
    const { result, capturedStdout } = await captureStdout(() =>
      runVersion({
        dryRun: true,
        noCommit: false,
        prune: false,
        emitJson: false,
        colorEnabled: false,
        yes: false,
      }),
    );

    // Then the plan is reported and the VERSION file is unchanged
    assertStringIncludes(capturedStdout, "Plan (dry-run)");
    assertStringIncludes(capturedStdout, "1.4.2 → 1.5.0");
    assertEquals(result.commitSha, null);
    const versionText = await Deno.readTextFile(fixture.versionFilePath);
    assertEquals(versionText.trim(), "1.4.2");
    // No CHANGELOG was created either
    let changelogExists = true;
    try {
      await Deno.stat(fixture.changelogPath);
    } catch {
      changelogExists = false;
    }
    assertEquals(changelogExists, false);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runVersion bumps the manifest, prepends the CHANGELOG, deletes the records, and commits", async () => {
  // Given a repo with a feat record and a fix record on core
  const fixture = await setUpFixture({
    initialVersion: "1.4.2",
    recordFiles: {
      "a.md":
        "---\ntype: feat\npackages:\n  - core\n---\n\nAdd OAuth device flow.\n",
      "b.md": "---\ntype: fix\npackages:\n  - core\n---\n\nPatch the parser.\n",
    },
  });

  try {
    // When dv version runs (no flags)
    const { result } = await captureStdout(() =>
      runVersion({
        noCommit: false,
        prune: false,
        emitJson: false,
        colorEnabled: false,
        yes: false,
      }),
    );

    // Then the manifest carries the projected version
    assertEquals(result.bumpedPackageCount, 1);
    assertEquals(result.consumedRecordCount, 2);
    const versionText = await Deno.readTextFile(fixture.versionFilePath);
    assertEquals(versionText.trim(), "1.5.0");

    // And the CHANGELOG has a new section with both bullets
    const changelogText = await Deno.readTextFile(fixture.changelogPath);
    assertStringIncludes(changelogText, "# Changelog");
    assertStringIncludes(changelogText, "## [1.5.0]");
    assertStringIncludes(changelogText, "- Add OAuth device flow.");
    assertStringIncludes(changelogText, "- Patch the parser.");

    // And both record files are gone
    const recordsDir = join(fixture.repoRootPath, ".changelog", "records");
    const remainingRecords: string[] = [];
    for await (const entry of Deno.readDir(recordsDir)) {
      if (entry.name.endsWith(".md")) remainingRecords.push(entry.name);
    }
    assertEquals(remainingRecords, []);

    // And one commit landed
    assertEquals(typeof result.commitSha, "string");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runVersion on an empty records directory is a no-op (Algebra §5 idempotence)", async () => {
  // Given a repo with no pending records
  const fixture = await setUpFixture({ initialVersion: "1.0.0" });

  try {
    // When dv version runs
    const { result, capturedStdout } = await captureStdout(() =>
      runVersion({
        noCommit: false,
        prune: false,
        emitJson: false,
        colorEnabled: false,
        yes: false,
      }),
    );

    // Then it reports nothing-to-do and creates no commit
    assertStringIncludes(capturedStdout, "nothing to version");
    assertEquals(result.commitSha, null);
    assertEquals(result.bumpedPackageCount, 0);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runVersion fails with code 'dirty-tree' when there are uncommitted changes", async () => {
  // Given a repo with a feat record and a stray uncommitted file
  const fixture = await setUpFixture({
    initialVersion: "1.4.2",
    recordFiles: {
      "a.md": "---\ntype: feat\npackages:\n  - core\n---\n\nA feature.\n",
    },
  });
  await Deno.writeTextFile(join(fixture.repoRootPath, "stray.txt"), "junk");

  try {
    // When dv version runs
    // Then it throws DvError carrying 'dirty-tree'
    const caughtError = await assertRejects(
      () =>
        runVersion({
          noCommit: false,
          prune: false,
          emitJson: false,
          colorEnabled: false,
          yes: false,
        }),
      DvError,
    );
    assertEquals(caughtError.code, "dirty-tree");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runVersion halts on an Unresolved Reference unless --prune is passed", async () => {
  // Given a record referencing an unknown package
  const fixture = await setUpFixture({
    initialVersion: "1.4.2",
    recordFiles: {
      "ghost.md":
        "---\ntype: fix\npackages:\n  - mystery\n---\n\nGhost change.\n",
    },
  });

  try {
    // When dv version runs without --prune
    // Then it throws 'unresolved-reference' without mutating anything
    const caughtError = await assertRejects(
      () =>
        runVersion({
          noCommit: false,
          prune: false,
          emitJson: false,
          colorEnabled: false,
          yes: false,
        }),
      DvError,
    );
    assertEquals(caughtError.code, "unresolved-reference");
    const versionText = await Deno.readTextFile(fixture.versionFilePath);
    assertEquals(versionText.trim(), "1.4.2");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runVersion --prune drops Unresolved References and succeeds", async () => {
  // Given a record referencing an unknown package + a normal feat record
  const fixture = await setUpFixture({
    initialVersion: "1.4.2",
    recordFiles: {
      "ghost.md":
        "---\ntype: fix\npackages:\n  - mystery\n---\n\nGhost change.\n",
      "real.md":
        "---\ntype: feat\npackages:\n  - core\n---\n\nA real feature.\n",
    },
  });

  try {
    // When dv version runs with --prune
    const { result } = await captureStdout(() =>
      runVersion({
        prune: true,
        noCommit: false,
        emitJson: false,
        colorEnabled: false,
        yes: false,
      }),
    );

    // Then the bump lands and both records are deleted (the orphan
    // because --prune, the real one because it was consumed)
    assertEquals(result.bumpedPackageCount, 1);
    const recordsDir = join(fixture.repoRootPath, ".changelog", "records");
    const remainingRecords: string[] = [];
    for await (const entry of Deno.readDir(recordsDir)) {
      if (entry.name.endsWith(".md")) remainingRecords.push(entry.name);
    }
    assertEquals(remainingRecords, []);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runVersion --no-commit stages the changes without producing a commit", async () => {
  // Given a repo with one feat record
  const fixture = await setUpFixture({
    initialVersion: "1.4.2",
    recordFiles: {
      "a.md": "---\ntype: feat\npackages:\n  - core\n---\n\nA feature.\n",
    },
  });

  try {
    // When dv version runs with --no-commit
    const { result } = await captureStdout(() =>
      runVersion({
        noCommit: true,
        prune: false,
        emitJson: false,
        colorEnabled: false,
        yes: false,
      }),
    );

    // Then no commit landed but the disk is mutated and changes are
    // staged
    assertEquals(result.commitSha, null);
    const statusOutput = await new Deno.Command("git", {
      args: ["-C", fixture.repoRootPath, "status", "--porcelain=v1"],
      stdout: "piped",
    }).output();
    const statusText = new TextDecoder().decode(statusOutput.stdout);
    // Both the CHANGELOG (new file) and the VERSION (modified) appear
    // in the index as staged.
    assertStringIncludes(statusText, "CHANGELOG.md");
    assertStringIncludes(statusText, "VERSION");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("status --json and version --dry-run --json produce the same Plan modulo `command`", async () => {
  // Given a repo with one feat and one fix record
  const fixture = await setUpFixture({
    initialVersion: "1.4.2",
    recordFiles: {
      "a.md": "---\ntype: feat\npackages:\n  - core\n---\n\nA feature.\n",
      "b.md": "---\ntype: fix\npackages:\n  - core\n---\n\nA bug fix.\n",
    },
  });

  try {
    const { runStatus } = await import("./status.ts");

    // When both commands run with --json
    const { capturedStdout: statusJson } = await captureStdout(() =>
      runStatus({ emitJson: true, colorEnabled: false }),
    );
    const { capturedStdout: versionJson } = await captureStdout(() =>
      runVersion({
        dryRun: true,
        noCommit: false,
        prune: false,
        emitJson: true,
        colorEnabled: false,
        yes: false,
      }),
    );

    // Then the two Plans agree on every field except `command`
    const statusPlan = JSON.parse(statusJson);
    const versionPlan = JSON.parse(versionJson);
    assertEquals(statusPlan.command, "status");
    assertEquals(versionPlan.command, "version");
    statusPlan.command = "x";
    versionPlan.command = "x";
    assertEquals(statusPlan, versionPlan);
  } finally {
    await fixture.cleanup();
  }
});
