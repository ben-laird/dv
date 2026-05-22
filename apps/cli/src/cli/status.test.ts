import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { rawPlanSchema } from "../subtools/versioning/plan-schema.ts";
import { runStatus } from "./status.ts";

// Integration tests for `dv status`. The end-to-end pipeline (config →
// discovery → records → read-version → buildVersionPlan) is exercised
// against a temp git repo with a hand-written shell plugin that fakes
// the discover and read-version Ops. The same fixture pattern is used
// by add.test.ts and version.test.ts so the costs are amortized.

interface SetUpRepoArgs {
  configYaml?: string;
  pluginScript: string;
  recordFiles?: Record<string, string>;
}

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoWithPlugin(
  args: SetUpRepoArgs,
): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-status-" });
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

  const recordsDir = join(configDir, "records");
  await Deno.mkdir(recordsDir, { recursive: true });
  for (const [recordFilename, recordContents] of Object.entries(
    args.recordFiles ?? {},
  )) {
    await Deno.writeTextFile(join(recordsDir, recordFilename), recordContents);
  }

  const pluginPath = join(repoRootPath, "plugin");
  await Deno.writeTextFile(
    pluginPath,
    `#!/usr/bin/env bash
set -euo pipefail
${args.pluginScript}
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

interface CaptureStdoutResult<T> {
  result: T;
  capturedStdout: string;
}

async function captureStdout<T>(
  action: () => Promise<T>,
): Promise<CaptureStdoutResult<T>> {
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

Deno.test("runStatus shows an empty plan and tracked-package count when no records are pending", async () => {
  // Given a repo with one discovered package, a version 1.4.2, and no records
  const fixture = await setUpRepoWithPlugin({
    pluginScript: `case "\${DV_OPERATION:-$1}" in
  discover)
    echo '{"packages":[{"name":"core","path":"packages/core"}]}'
    ;;
  read-version)
    echo '{"version":"1.4.2"}'
    ;;
esac`,
  });

  try {
    // When status runs
    const { result, capturedStdout } = await captureStdout(() =>
      runStatus({ emitJson: false, colorEnabled: false }),
    );

    // Then pending is empty and the human output names the package count
    assertEquals(result.plan?.pending, []);
    assertEquals(result.plan?.unresolvedReferences, []);
    assertEquals(capturedStdout.includes("no pending records"), true);
    assertEquals(capturedStdout.includes("1 package tracked"), true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runStatus reports pending bumps with current → projected versions", async () => {
  // Given a repo with one discovered package, a version, and two records
  // (one feat, one fix) on that package
  const fixture = await setUpRepoWithPlugin({
    pluginScript: `case "\${DV_OPERATION:-$1}" in
  discover)
    echo '{"packages":[{"name":"core","path":"packages/core"}]}'
    ;;
  read-version)
    echo '{"version":"1.4.2"}'
    ;;
esac`,
    recordFiles: {
      "a.md": "---\ntype: feat\npackages:\n  - core\n---\n\nAdd a feature.\n",
      "b.md": "---\ntype: fix\npackages:\n  - core\n---\n\nFix a bug.\n",
    },
  });

  try {
    // When status runs
    const { result, capturedStdout } = await captureStdout(() =>
      runStatus({ emitJson: false, colorEnabled: false }),
    );

    // Then the projected version, bump, and change counts surface
    assertEquals(result.plan?.pending.length, 1);
    assertEquals(result.plan?.pending[0]?.currentVersion, "1.4.2");
    assertEquals(result.plan?.pending[0]?.projectedVersion, "1.5.0");
    assertEquals(result.plan?.pending[0]?.bump, "minor");
    assertEquals(capturedStdout.includes("Pending Records"), true);
    assertEquals(capturedStdout.includes("1.4.2 → 1.5.0"), true);
    assertEquals(capturedStdout.includes("1 feat, 1 fix"), true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runStatus --json emits a Plan that validates against rawPlanSchema", async () => {
  // Given a repo with one package and one feat record
  const fixture = await setUpRepoWithPlugin({
    pluginScript: `case "\${DV_OPERATION:-$1}" in
  discover)
    echo '{"packages":[{"name":"core","path":"packages/core"}]}'
    ;;
  read-version)
    echo '{"version":"0.4.2"}'
    ;;
esac`,
    recordFiles: {
      "a.md": "---\ntype: feat\npackages:\n  - core\n---\n\nFirst feature.\n",
    },
  });

  try {
    // When status runs with --json
    const { capturedStdout } = await captureStdout(() =>
      runStatus({ emitJson: true, colorEnabled: false }),
    );

    // Then the captured JSON parses as a contract-valid Plan
    const parsedPlan = JSON.parse(capturedStdout);
    rawPlanSchema.parse(parsedPlan);
    assertEquals(parsedPlan.command, "status");
    assertEquals(parsedPlan.pending[0]?.projectedVersion, "0.5.0");
    assertEquals(parsedPlan.pending[0]?.stability, "Unstable");
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runStatus reports Unresolved References without aborting", async () => {
  // Given a repo where a record names a package not claimed by any plugin
  const fixture = await setUpRepoWithPlugin({
    pluginScript: `case "\${DV_OPERATION:-$1}" in
  discover)
    echo '{"packages":[{"name":"core","path":"packages/core"}]}'
    ;;
  read-version)
    echo '{"version":"1.0.0"}'
    ;;
esac`,
    recordFiles: {
      "ghost.md":
        "---\ntype: fix\npackages:\n  - mystery\n---\n\nGhost change.\n",
    },
  });

  try {
    // When status runs
    const { result, capturedStdout } = await captureStdout(() =>
      runStatus({ emitJson: false, colorEnabled: false }),
    );

    // Then the unresolved reference appears in the plan and the human
    // output names it; the command does not throw
    assertEquals(result.plan?.unresolvedReferences, [
      { record: "ghost.md", reference: "mystery" },
    ]);
    assertEquals(capturedStdout.includes("Unresolved references"), true);
    assertEquals(capturedStdout.includes("mystery"), true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("runStatus surfaces a config-missing hint when .changelog/config.yaml is absent", async () => {
  // Given a fresh repo with no .changelog/ directory
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-status-empty-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);
  try {
    const gitInitResult = await new Deno.Command("git", {
      args: ["init", "-q"],
    }).output();
    if (!gitInitResult.success) throw new Error("git init failed");

    // When status runs
    const { result, capturedStdout } = await captureStdout(() =>
      runStatus({ emitJson: false, colorEnabled: false }),
    );

    // Then the human output points at `dv init` and the result flags
    // the missing config
    assertEquals(result.configMissing, true);
    assertEquals(capturedStdout.includes("no config found"), true);
    assertEquals(capturedStdout.includes("dv init"), true);
  } finally {
    Deno.chdir(previousWorkingDirectory);
    await Deno.remove(repoRootPath, { recursive: true });
  }
});
