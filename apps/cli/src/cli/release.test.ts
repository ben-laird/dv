import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import { DvError } from "../domain/errors.ts";
import { runRelease } from "./release.ts";

// Integration tests for `dv release` against temp git repos using
// the real `examples/plugins/deno` plugin — same dogfooding-grade
// fixture pattern the cascade tests in version.test.ts use. Each
// fixture sets up two packages (pkg-a, pkg-b) so multi-package
// behavior (per-Package outcomes, push batching, --force iteration)
// can be exercised in one shape.

interface SetUpReleaseFixtureArgs {
  // Initial versions on disk; defaults 1.0.0 each.
  initialVersionA?: string;
  initialVersionB?: string;
  // Pre-existing tags to mint before the test runs (so the run sees
  // them as "already tagged").
  preExistingTags?: string[];
  // Should a bare remote be set up for push tests?
  withBareRemote?: boolean;
  // Override the example plugin's `release` script with custom
  // behavior — e.g. exit-nonzero to simulate a failed publish.
  releaseScriptOverride?: string;
}

interface ReleaseFixtureResult {
  repoRootPath: string;
  bareRemotePath: string | null;
  manifestPathA: string;
  manifestPathB: string;
  cleanup: () => Promise<void>;
}

async function setUpReleaseFixture(
  args: SetUpReleaseFixtureArgs,
): Promise<ReleaseFixtureResult> {
  const baseDir = await Deno.makeTempDir({ prefix: "dv-release-" });
  const repoRootPath = args.withBareRemote ? join(baseDir, "working") : baseDir;
  if (args.withBareRemote) {
    await Deno.mkdir(repoRootPath, { recursive: true });
  }
  const bareRemotePath = args.withBareRemote
    ? join(baseDir, "remote.git")
    : null;
  if (bareRemotePath !== null) {
    await new Deno.Command("git", {
      args: ["init", "-q", "--bare", bareRemotePath],
    }).output();
  }

  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);

  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
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
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "tag.gpgsign", "false"],
  }).output();
  if (bareRemotePath !== null) {
    await new Deno.Command("git", {
      args: ["-C", repoRootPath, "remote", "add", "origin", bareRemotePath],
    }).output();
  }

  // Resolve the real example plugin from this test file's location.
  const thisFileDir = fromFileUrl(new URL(".", import.meta.url));
  let examplePluginPath = resolve(
    thisFileDir,
    "../../../../examples/plugins/deno",
  );

  // If the test wants to override the release Op behavior, copy the
  // example plugin into a per-fixture directory inside the temp dir
  // and replace just the `release` script.
  if (args.releaseScriptOverride !== undefined) {
    const overlayPluginPath = join(repoRootPath, "plugin");
    await Deno.mkdir(overlayPluginPath, { recursive: true });
    for (const opName of [
      "discover",
      "read-version",
      "write-version",
      "update-dependency",
    ]) {
      const sourcePath = join(examplePluginPath, opName);
      const destinationPath = join(overlayPluginPath, opName);
      await Deno.copyFile(sourcePath, destinationPath);
      await Deno.chmod(destinationPath, 0o755);
    }
    const releaseScriptPath = join(overlayPluginPath, "release");
    await Deno.writeTextFile(releaseScriptPath, args.releaseScriptOverride);
    await Deno.chmod(releaseScriptPath, 0o755);
    examplePluginPath = overlayPluginPath;
  }

  const changelogDir = join(repoRootPath, ".changelog");
  await Deno.mkdir(changelogDir, { recursive: true });
  await Deno.writeTextFile(
    join(changelogDir, "config.yaml"),
    `discovery:
  plugins:
    - match: "packages/*"
      use: ${examplePluginPath}
`,
  );
  await Deno.mkdir(join(changelogDir, "records"), { recursive: true });

  const packageADir = join(repoRootPath, "packages", "pkg-a");
  const packageBDir = join(repoRootPath, "packages", "pkg-b");
  await Deno.mkdir(packageADir, { recursive: true });
  await Deno.mkdir(packageBDir, { recursive: true });
  const manifestPathA = join(packageADir, "deno.json");
  const manifestPathB = join(packageBDir, "deno.json");
  await Deno.writeTextFile(
    manifestPathA,
    `${JSON.stringify({ name: "pkg-a", version: args.initialVersionA ?? "1.0.0" }, null, 2)}\n`,
  );
  await Deno.writeTextFile(
    manifestPathB,
    `${JSON.stringify({ name: "pkg-b", version: args.initialVersionB ?? "1.0.0" }, null, 2)}\n`,
  );

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

  for (const tag of args.preExistingTags ?? []) {
    await new Deno.Command("git", {
      args: ["-C", repoRootPath, "tag", "-a", tag, "-m", `Release ${tag}`],
    }).output();
  }

  return {
    repoRootPath,
    bareRemotePath,
    manifestPathA,
    manifestPathB,
    cleanup: async () => {
      Deno.chdir(previousWorkingDirectory);
      await Deno.remove(baseDir, { recursive: true });
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

async function listTagsInRepo(repoRootPath: string): Promise<string[]> {
  const tagListResult = await new Deno.Command("git", {
    args: ["-C", repoRootPath, "tag", "--list"],
    stdout: "piped",
  }).output();
  return new TextDecoder()
    .decode(tagListResult.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

Deno.test("runRelease mints tags only for untagged packages and invokes the release op once each", async () => {
  // Given two packages where pkg-a is already tagged but pkg-b is
  // not
  const fixture = await setUpReleaseFixture({
    preExistingTags: ["pkg-a@1.0.0"],
  });

  try {
    // When dv release runs (with --yes to bypass the prompt)
    const result = await runRelease({
      force: false,
      yes: true,
      emitJson: false,
      colorEnabled: false,
    });

    // Then only pkg-b got a new tag; the release op fired once
    assertEquals(result.mintedTagNames, ["pkg-b@1.0.0"]);
    assertEquals(result.reusedTagNames, []);
    assertEquals(result.releaseOpOutcomes.length, 1);
    assertEquals(result.releaseOpOutcomes[0]?.package, "pkg-b");
    assertEquals(result.releaseOpOutcomes[0]?.ok, true);

    // And the local tag exists
    const tags = await listTagsInRepo(fixture.repoRootPath);
    assertEquals(tags.includes("pkg-b@1.0.0"), true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRelease --dry-run lists the plan without minting or invoking", async () => {
  // Given two packages with no tags
  const fixture = await setUpReleaseFixture({});

  try {
    // When dv release --dry-run runs
    const { result, capturedStdout } = await captureStdout(() =>
      runRelease({
        dryRun: true,
        force: false,
        yes: true,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the plan is printed
    assertStringIncludes(capturedStdout, "Plan (dry-run)");
    assertStringIncludes(capturedStdout, "pkg-a@1.0.0");
    assertStringIncludes(capturedStdout, "pkg-b@1.0.0");

    // And no tags exist on disk
    const tags = await listTagsInRepo(fixture.repoRootPath);
    assertEquals(tags, []);

    // And no release op was invoked
    assertEquals(result.releaseOpOutcomes, []);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRelease on a fully-released set is a no-op (Algebra §5 idempotence)", async () => {
  // Given every package is already tagged at its current version
  const fixture = await setUpReleaseFixture({
    preExistingTags: ["pkg-a@1.0.0", "pkg-b@1.0.0"],
  });

  try {
    // When dv release runs without --force
    const { result, capturedStdout } = await captureStdout(() =>
      runRelease({
        force: false,
        yes: true,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then no plugin invocation, no new tags, the documented
    // "nothing to release" message
    assertStringIncludes(capturedStdout, "nothing to release");
    assertEquals(result.mintedTagNames, []);
    assertEquals(result.releaseOpOutcomes, []);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRelease --force re-runs the release op for already-tagged packages without re-minting", async () => {
  // Given every package is already tagged
  const fixture = await setUpReleaseFixture({
    preExistingTags: ["pkg-a@1.0.0", "pkg-b@1.0.0"],
  });

  try {
    // When dv release --force runs
    const result = await runRelease({
      force: true,
      yes: true,
      emitJson: false,
      colorEnabled: false,
    });

    // Then no new tags are minted (the existing ones are reused)
    // but the release op fires for both packages — the documented
    // failed-publish recovery path
    assertEquals(result.mintedTagNames, []);
    assertEquals(result.reusedTagNames.length, 2);
    assertEquals(result.releaseOpOutcomes.length, 2);
    assertEquals(
      result.releaseOpOutcomes.every((outcome) => outcome.ok),
      true,
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRelease celebrates first-stable transitions in the human summary", async () => {
  // Given a package at exactly 1.0.0 with no prior tags
  const fixture = await setUpReleaseFixture({
    initialVersionA: "1.0.0",
    initialVersionB: "0.5.0",
  });

  try {
    // When dv release runs
    const { result, capturedStdout } = await captureStdout(() =>
      runRelease({
        force: false,
        yes: true,
        emitJson: false,
        colorEnabled: false,
      }),
    );

    // Then the celebration line surfaces for pkg-a (1.0.0 with no
    // prior tags = first stable per Algebra §3); pkg-b is at 0.5.0
    // and doesn't get the line
    assertStringIncludes(capturedStdout, "🎉");
    assertStringIncludes(capturedStdout, "pkg-a promoted to 1.0.0");
    assertEquals(capturedStdout.includes("pkg-b promoted"), false);

    // And the JSON-side firstStable flag matches
    const firstStableEntries = result.plan.awaitingRelease.filter(
      (entry) => entry.firstStable,
    );
    assertEquals(firstStableEntries.length, 1);
    assertEquals(firstStableEntries[0]?.package, "pkg-a");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRelease --push sends minted tags to the configured remote", async () => {
  // Given two untagged packages and a bare remote configured
  const fixture = await setUpReleaseFixture({
    withBareRemote: true,
  });

  try {
    // When dv release runs with --push
    const result = await runRelease({
      force: false,
      push: true,
      yes: true,
      emitJson: false,
      colorEnabled: false,
    });

    // Then both minted tags appear on the remote
    assertEquals(result.pushedTagNames.length, 2);
    if (fixture.bareRemotePath === null) throw new Error("bare remote missing");
    const remoteTags = await listTagsInRepo(fixture.bareRemotePath);
    assertEquals(remoteTags.includes("pkg-a@1.0.0"), true);
    assertEquals(remoteTags.includes("pkg-b@1.0.0"), true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRelease continues past a non-zero release op exit, surfacing failures in the summary", async () => {
  // Given the example plugin's release script is overridden to exit
  // non-zero (simulating a failed publish)
  const failingReleaseScript = `#!/usr/bin/env -S deno run --allow-env
console.error("simulated publish failure");
Deno.exit(1);
`;
  const fixture = await setUpReleaseFixture({
    releaseScriptOverride: failingReleaseScript,
  });

  try {
    // When dv release runs
    const result = await runRelease({
      force: false,
      yes: true,
      emitJson: false,
      colorEnabled: false,
    });

    // Then tags are still minted (publish failures DO NOT roll back
    // tags per specs/plugin-contract.md) but every outcome is
    // recorded as failed
    assertEquals(result.mintedTagNames.length, 2);
    assertEquals(result.releaseOpOutcomes.length, 2);
    assertEquals(
      result.releaseOpOutcomes.every((outcome) => !outcome.ok),
      true,
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runRelease in a non-TTY context without --yes throws DvError('confirmation-required')", async () => {
  // Given a release set + non-TTY stdin (the default in `deno test`)
  const fixture = await setUpReleaseFixture({});

  try {
    // When dv release runs without --yes
    // Then DvError surfaces with the documented code; nothing is
    // mutated
    const caughtError = await assertRejects(
      () =>
        runRelease({
          force: false,
          yes: false,
          emitJson: false,
          colorEnabled: false,
        }),
      DvError,
    );
    assertEquals(caughtError.code, "confirmation-required");
    const tags = await listTagsInRepo(fixture.repoRootPath);
    assertEquals(tags, []);
  } finally {
    await fixture.cleanup();
  }
});
