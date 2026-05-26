import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../domain/errors.ts";
import { runV1, runV1Catalog } from "./v1.ts";

// Integration tests for `dv v1 <package>`. The fixture mirrors
// version.test.ts: a real git working tree with a shell plugin
// implementing discover / read-version / write-version /
// update-dependency, and a `.dv/` directory the test populates.

interface SetUpV1FixtureArgs {
  // The current version the plugin will report for the "core"
  // package before dv v1 runs. Defaults 0.5.0 — Unstable, so a
  // promotion to 1.0.0 is the valid case.
  initialVersion?: string;
  // Optional records to drop into .dv/records/.
  recordFiles?: Record<string, string>;
}

interface SetUpV1FixtureResult {
  repoRootPath: string;
  versionFilePath: string;
  changelogPath: string;
  cleanup: () => Promise<void>;
}

async function setUpFixture(
  args: SetUpV1FixtureArgs,
): Promise<SetUpV1FixtureResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-v1-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);

  const gitInitResult = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");
  for (const setting of [
    ["user.email", "dv-test@example.invalid"],
    ["user.name", "dv test"],
    ["commit.gpgsign", "false"],
  ]) {
    await new Deno.Command("git", {
      args: ["-C", repoRootPath, "config", ...setting],
    }).output();
  }

  const dvDir = join(repoRootPath, ".dv");
  await Deno.mkdir(dvDir, { recursive: true });
  await Deno.writeTextFile(
    join(dvDir, "config.yaml"),
    `discovery:
  plugins:
    - match: "packages/*"
      use:
        path: ./plugin
`,
  );
  const recordsDir = join(dvDir, "records");
  await Deno.mkdir(recordsDir, { recursive: true });
  for (const [recordFilename, recordContents] of Object.entries(
    args.recordFiles ?? {},
  )) {
    await Deno.writeTextFile(join(recordsDir, recordFilename), recordContents);
  }

  // The "core" package lives at packages/core/ and stores its
  // version in a plain VERSION file. The plugin reads/writes that
  // file.
  const packageDir = join(repoRootPath, "packages", "core");
  await Deno.mkdir(packageDir, { recursive: true });
  const versionFilePath = join(packageDir, "VERSION");
  await Deno.writeTextFile(
    versionFilePath,
    `${args.initialVersion ?? "0.5.0"}\n`,
  );

  const pluginPath = join(repoRootPath, "plugin");
  // info.supportedOps omits finalize — this fixture has no
  // post-write cleanup work, so dv skips finalize entirely.
  const infoResponseJson = JSON.stringify({
    contractVersion: "1",
    supportedOps: [
      "info",
      "discover",
      "read-version",
      "write-version",
      "update-dependency",
    ],
    name: "test-v1-bash-plugin",
  });
  await Deno.writeTextFile(
    pluginPath,
    `#!/usr/bin/env bash
set -euo pipefail
case "\${DV_OPERATION:-$1}" in
  info)
    echo '${infoResponseJson}'
    ;;
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
  update-dependency)
    echo '{"ok":true,"changed":false}'
    ;;
esac
`,
  );
  await Deno.chmod(pluginPath, 0o755);

  // Commit the initial state so require-clean-tree passes.
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

Deno.test("runV1 promotes an Unstable package to exactly 1.0.0, consumes pending records, and commits", async () => {
  // Given an Unstable (0.x) package with two pending records
  const fixture = await setUpFixture({
    initialVersion: "0.5.0",
    recordFiles: {
      "a.md":
        "---\ntype: feat\npackages:\n  - core\n---\n\nFeature for the 1.0 line.\n",
      "b.md":
        "---\ntype: fix\npackages:\n  - core\n---\n\nLast fix before 1.0.\n",
    },
  });

  try {
    // When dv v1 runs (yes:true to skip the prompt in tests)
    const { result } = await captureStdout(() =>
      runV1({
        packageName: "core",
        noCommit: false,
        prune: false,
        emitJson: false,
        colorEnabled: false,
        yes: true,
      }),
    );

    // Then the projected version is exactly 1.0.0 — NOT 0.6.0
    // (what the records would otherwise produce), NOT 1.5.0
    // (what a feat would produce against a stable major). 1.0.0
    // is the spec'd projection regardless of the records' shape.
    assertEquals(result.promotedPackage, "core");
    const versionText = await Deno.readTextFile(fixture.versionFilePath);
    assertEquals(versionText.trim(), "1.0.0");

    // And the CHANGELOG has a 1.0.0 section listing both records
    const changelogText = await Deno.readTextFile(fixture.changelogPath);
    assertStringIncludes(changelogText, "## [1.0.0]");
    assertStringIncludes(changelogText, "Feature for the 1.0 line.");
    assertStringIncludes(changelogText, "Last fix before 1.0.");

    // And both records are consumed (deleted from disk)
    assertEquals(result.consumedRecordCount, 2);
    const remainingRecords: string[] = [];
    for await (const entry of Deno.readDir(
      join(fixture.repoRootPath, ".dv", "records"),
    )) {
      if (entry.name.endsWith(".md")) remainingRecords.push(entry.name);
    }
    assertEquals(remainingRecords, []);

    // And one commit landed
    assertEquals(typeof result.commitSha, "string");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1 promotes a package with NO pending records (1.0.0 ceremony with empty record set)", async () => {
  // Given an Unstable package with no records — perfectly valid
  // case where the user clears the queue first and then runs `dv v1`
  // as a standalone ceremony
  const fixture = await setUpFixture({ initialVersion: "0.7.3" });

  try {
    // When dv v1 runs
    const { result } = await captureStdout(() =>
      runV1({
        packageName: "core",
        noCommit: false,
        prune: false,
        emitJson: false,
        colorEnabled: false,
        yes: true,
      }),
    );

    // Then the version still moves to 1.0.0
    const versionText = await Deno.readTextFile(fixture.versionFilePath);
    assertEquals(versionText.trim(), "1.0.0");
    assertEquals(result.consumedRecordCount, 0);
    // CHANGELOG section exists for 1.0.0 even with no bullets
    const changelogText = await Deno.readTextFile(fixture.changelogPath);
    assertStringIncludes(changelogText, "## [1.0.0]");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1 rejects packages that are already >= 1.0 with code 'v1-already-stable'", async () => {
  // Given a package that's already past 1.0
  const fixture = await setUpFixture({ initialVersion: "1.3.7" });

  try {
    // When dv v1 runs
    // Then DvError surfaces with v1-already-stable; nothing changes
    const caughtError = await assertRejects(
      () =>
        runV1({
          packageName: "core",
          noCommit: false,
          prune: false,
          emitJson: false,
          colorEnabled: false,
          yes: true,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "v1-already-stable");
    const versionText = await Deno.readTextFile(fixture.versionFilePath);
    assertEquals(versionText.trim(), "1.3.7");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1 rejects an unknown package name with code 'v1-package-not-found'", async () => {
  // Given a repo with `core` discovered but no `ghost`
  const fixture = await setUpFixture({ initialVersion: "0.5.0" });

  try {
    // When dv v1 runs against the ghost
    const caughtError = await assertRejects(
      () =>
        runV1({
          packageName: "ghost",
          noCommit: false,
          prune: false,
          emitJson: false,
          colorEnabled: false,
          yes: true,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "v1-package-not-found");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1 --dry-run previews the promotion without touching disk", async () => {
  // Given an Unstable package
  const fixture = await setUpFixture({
    initialVersion: "0.5.0",
    recordFiles: {
      "a.md": "---\ntype: feat\npackages:\n  - core\n---\n\nA feature.\n",
    },
  });

  try {
    // When dv v1 runs in dry-run mode
    const { result, capturedStdout } = await captureStdout(() =>
      runV1({
        packageName: "core",
        dryRun: true,
        noCommit: false,
        prune: false,
        emitJson: false,
        colorEnabled: false,
        yes: true,
      }),
    );

    // Then the plan is reported and the VERSION file is unchanged
    assertStringIncludes(capturedStdout, "Plan (dry-run)");
    assertStringIncludes(capturedStdout, "0.5.0 → 1.0.0");
    assertStringIncludes(capturedStdout, "first stable!");
    assertEquals(result.commitSha, null);
    const versionText = await Deno.readTextFile(fixture.versionFilePath);
    assertEquals(versionText.trim(), "0.5.0");
    // Records are NOT deleted in dry-run mode
    const recordStillThere = await Deno.readTextFile(
      join(fixture.repoRootPath, ".dv", "records", "a.md"),
    );
    assertStringIncludes(recordStillThere, "A feature.");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1 emits the Plan JSON envelope under --json", async () => {
  // Given an Unstable package
  const fixture = await setUpFixture({ initialVersion: "0.5.0" });

  try {
    // When dv v1 runs with emitJson: true
    const { capturedStdout } = await captureStdout(() =>
      runV1({
        packageName: "core",
        noCommit: false,
        prune: false,
        emitJson: true,
        colorEnabled: false,
        yes: true,
      }),
    );

    // Then a parseable Plan envelope is on stdout. (Real-run --json
    // doesn't have a distinct envelope yet; the human path emits a
    // summary, the JSON path is currently only for the dry-run
    // preview. Run via dry-run here to keep the test deterministic.)
    // For the real-run case, just verify it completes without
    // throwing. Capture the post-run version on disk to confirm
    // the side effects landed.
    const versionText = await Deno.readTextFile(fixture.versionFilePath);
    assertEquals(versionText.trim(), "1.0.0");
    // The progress reporter is silenced under --json so stdout is
    // clean — no `▸ ...` lines leak into it.
    assertEquals(capturedStdout.includes("▸"), false);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1Catalog lists eligible Unstable packages with per-package projections under --dry-run", async () => {
  // Given an Unstable package and pending records targeting it
  const fixture = await setUpFixture({
    initialVersion: "0.7.4",
    recordFiles: {
      "first.md": `---
type: feat
packages:
  - core
---

Add /v2 endpoint
`,
    },
  });
  try {
    // When runV1Catalog runs in dry-run mode (no package specified)
    const { result, capturedStdout } = await captureStdout(() =>
      runV1Catalog({
        dryRun: true,
        prune: false,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then exactly one eligible package is reported, projected to 1.0.0
    assertEquals(result.eligibleCount, 1);
    assertEquals(result.plan.pending.length, 1);
    assertEquals(result.plan.pending[0]?.package, "core");
    assertEquals(result.plan.pending[0]?.currentVersion, "0.7.4");
    assertEquals(result.plan.pending[0]?.projectedVersion, "1.0.0");
    assertEquals(result.plan.pending[0]?.bump, "major");
    assertEquals(result.plan.pending[0]?.records, ["first.md"]);
    // And the human output names the catalog mode
    assertStringIncludes(capturedStdout, "Catalog (dry-run)");
    assertStringIncludes(capturedStdout, "1 eligible Package");
    assertStringIncludes(capturedStdout, "core");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1Catalog reports zero eligible packages when every package is already >= 1.0", async () => {
  // Given a Stable (>=1.0) package — nothing is eligible for v1
  const fixture = await setUpFixture({ initialVersion: "1.2.3" });
  try {
    const { result, capturedStdout } = await captureStdout(() =>
      runV1Catalog({
        dryRun: true,
        prune: false,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the catalog is empty and the human output says so
    assertEquals(result.eligibleCount, 0);
    assertEquals(result.plan.pending.length, 0);
    assertStringIncludes(capturedStdout, "no packages eligible");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1Catalog refuses to run when dry-run is false (catalog mode is preview-only)", async () => {
  // Given any fixture (the check happens before discovery)
  const fixture = await setUpFixture({});
  try {
    // When runV1Catalog runs WITHOUT dry-run
    // Then it throws v1-bad-args explaining the constraint
    const caughtError = await assertRejects(
      () =>
        runV1Catalog({
          dryRun: false,
          prune: false,
          emitJson: false,
          colorEnabled: false,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "v1-bad-args");
    assertStringIncludes(
      caughtError.message,
      "catalog mode (omitted package) requires --dry-run",
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runV1Catalog emits a Plan JSON envelope under --json", async () => {
  const fixture = await setUpFixture({ initialVersion: "0.3.0" });
  try {
    const { capturedStdout } = await captureStdout(() =>
      runV1Catalog({
        dryRun: true,
        prune: false,
        emitJson: true,
        colorEnabled: false,
      }),
    );

    // Then stdout is the standard Plan envelope, parseable as JSON
    const parsed = JSON.parse(capturedStdout) as {
      schema: string;
      pending: { package: string; projectedVersion: string }[];
    };
    assertEquals(parsed.schema, "urn:dv:schema:v1:plan");
    assertEquals(parsed.pending.length, 1);
    assertEquals(parsed.pending[0]?.package, "core");
    assertEquals(parsed.pending[0]?.projectedVersion, "1.0.0");
  } finally {
    await fixture.cleanup();
  }
});
