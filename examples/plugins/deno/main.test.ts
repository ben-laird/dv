import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

// Black-box tests for the example Deno plugin: each test runs the
// plugin the way dv does (an Op name in argv, env vars, optional
// JSON on stdin) and checks the JSON response plus any file edits.

const pluginEntryPath = fromFileUrl(import.meta.resolve("./main.ts"));

interface OpOutcome {
  exitCode: number;
  response: unknown;
}

interface RunOpArgs {
  op: string;
  env: Record<string, string>;
  stdin?: unknown;
}

async function runOp(args: RunOpArgs): Promise<OpOutcome> {
  const { outcome } = await runOpCapturingStderr(args);
  return outcome;
}

async function runOpCapturingStderr({
  op,
  env,
  stdin,
}: RunOpArgs): Promise<{ outcome: OpOutcome; stderr: string }> {
  const child = new Deno.Command("deno", {
    args: ["run", "-A", pluginEntryPath, op],
    env: { ...env, DV_OPERATION: op },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(stdin === undefined ? "" : JSON.stringify(stdin)),
  );
  await writer.close();
  const output = await child.output();
  const stdoutText = new TextDecoder().decode(output.stdout).trim();
  const response = stdoutText === "" ? undefined : JSON.parse(stdoutText);
  return {
    outcome: { exitCode: output.code, response },
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function withTempDir(
  body: (tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "dv-deno-plugin-" });
  try {
    await body(tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

const TAB_INDENTED_MANIFEST = `{
\t"name": "@fixture/tabs",
\t"version": "1.2.3",
\t"exports": "./mod.ts",

\t"imports": {
\t\t"@fixture/core": "jsr:@fixture/core@^1.0.0",
\t\t"@std/path": "jsr:@std/path@^1"
\t},

\t"tasks": { "test": "deno test" }
}
`;

Deno.test("write-version on a tab-indented deno.json changes only the version", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a tab-indented manifest with blank-line grouping
    const manifestPath = join(packageDir, "deno.json");
    await Deno.writeTextFile(manifestPath, TAB_INDENTED_MANIFEST);

    // When: dv writes a new version
    const outcome = await runOp({
      op: "write-version",
      env: { DV_PACKAGE_PATH: packageDir, DV_NEW_VERSION: "1.3.0" },
    });

    // Then: the file is byte-identical apart from the version value
    assertEquals(outcome, { exitCode: 0, response: { ok: true } });
    assertEquals(
      await Deno.readTextFile(manifestPath),
      TAB_INDENTED_MANIFEST.replace('"1.2.3"', '"1.3.0"'),
    );
  });
});

Deno.test("write-version inserts a missing version after name with matching indentation", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a tab-indented manifest with no version field yet
    const manifestPath = join(packageDir, "deno.json");
    await Deno.writeTextFile(
      manifestPath,
      `{\n\t"name": "@fixture/fresh",\n\t"exports": "./mod.ts"\n}\n`,
    );

    // When: dv writes the first version
    const outcome = await runOp({
      op: "write-version",
      env: { DV_PACKAGE_PATH: packageDir, DV_NEW_VERSION: "0.1.0" },
    });

    // Then: the version lands next to name, indented like its siblings
    assertEquals(outcome.exitCode, 0);
    assertEquals(
      await Deno.readTextFile(manifestPath),
      `{\n\t"name": "@fixture/fresh",\n\t"version": "0.1.0",\n\t"exports": "./mod.ts"\n}\n`,
    );
  });
});

Deno.test("write-version edits deno.jsonc and keeps its comments", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a deno.jsonc manifest carrying comments and a trailing comma
    const manifestPath = join(packageDir, "deno.jsonc");
    const original = `{
  // The package name on JSR.
  "name": "@fixture/commented",
  /* bumped by dv */ "version": "2.0.0",
}
`;
    await Deno.writeTextFile(manifestPath, original);

    // When: dv reads, then writes, the version
    const readOutcome = await runOp({
      op: "read-version",
      env: { DV_PACKAGE_PATH: packageDir },
    });
    const writeOutcome = await runOp({
      op: "write-version",
      env: { DV_PACKAGE_PATH: packageDir, DV_NEW_VERSION: "2.1.0" },
    });

    // Then: the version is read and rewritten in place, comments intact
    assertEquals(readOutcome.response, { version: "2.0.0" });
    assertEquals(writeOutcome.response, { ok: true });
    assertEquals(
      await Deno.readTextFile(manifestPath),
      original.replace('"2.0.0"', '"2.1.0"'),
    );
  });
});

Deno.test("write-version edits the last of duplicate version keys, the one parsers keep", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a manifest that repeats `version`; JSON(C) parsing keeps the last
    const manifestPath = join(packageDir, "deno.json");
    const original = `{\n\t"name": "@fixture/dupe",\n\t"version": "0.0.1",\n\t"version": "1.0.0"\n}\n`;
    await Deno.writeTextFile(manifestPath, original);

    // When: dv writes a new version
    const outcome = await runOp({
      op: "write-version",
      env: { DV_PACKAGE_PATH: packageDir, DV_NEW_VERSION: "1.1.0" },
    });

    // Then: the effective (last) key changes and the shadowed one is untouched
    assertEquals(outcome, { exitCode: 0, response: { ok: true } });
    assertEquals(
      await Deno.readTextFile(manifestPath),
      original.replace('"1.0.0"', '"1.1.0"'),
    );
  });
});

Deno.test("update-dependency on a tab-indented deno.json changes only the constraint", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a tab-indented manifest importing @fixture/core
    const manifestPath = join(packageDir, "deno.json");
    await Deno.writeTextFile(manifestPath, TAB_INDENTED_MANIFEST);

    // When: dv cascades a new @fixture/core version
    const outcome = await runOp({
      op: "update-dependency",
      env: { DV_PACKAGE_PATH: packageDir },
      stdin: {
        package: "@fixture/tabs",
        package_path: packageDir,
        dependency: "@fixture/core",
        new_version: "1.4.0",
      },
    });

    // Then: only the import specifier moved, keeping its caret
    assertEquals(outcome, {
      exitCode: 0,
      response: { ok: true, changed: true },
    });
    assertEquals(
      await Deno.readTextFile(manifestPath),
      TAB_INDENTED_MANIFEST.replace(
        "jsr:@fixture/core@^1.0.0",
        "jsr:@fixture/core@^1.4.0",
      ),
    );
  });
});

Deno.test("update-dependency leaves a manifest without the dependency untouched", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a manifest that does not import the bumped package
    const manifestPath = join(packageDir, "deno.json");
    await Deno.writeTextFile(manifestPath, TAB_INDENTED_MANIFEST);

    // When: dv cascades an unrelated dependency
    const outcome = await runOp({
      op: "update-dependency",
      env: { DV_PACKAGE_PATH: packageDir },
      stdin: { dependency: "@fixture/other", new_version: "3.0.0" },
    });

    // Then: the op reports no change and the file is unchanged
    assertEquals(outcome.response, { ok: true, changed: false });
    assertEquals(await Deno.readTextFile(manifestPath), TAB_INDENTED_MANIFEST);
  });
});

// A Deno workspace where member `a` imports member `b` by name with
// no `imports` entry — the workspace alone resolves `@fixture/b`.
async function writeWorkspaceFixture(repoRoot: string): Promise<void> {
  await Deno.writeTextFile(
    join(repoRoot, "deno.json"),
    `{ "workspace": ["./packages/a", "./packages/b", "./packages/c"] }\n`,
  );
  const members: Record<string, { manifest: unknown; source: string }> = {
    a: {
      manifest: { name: "@fixture/a", version: "1.0.0", exports: "./mod.ts" },
      source: `import { b } from "@fixture/b";\nexport const a = b + 1;\n`,
    },
    b: {
      manifest: {
        name: "@fixture/b",
        version: "1.0.0",
        exports: { ".": "./mod.ts" },
      },
      source: "export const b = 1;\n",
    },
    c: {
      manifest: { name: "@fixture/c", version: "1.0.0", exports: "./mod.ts" },
      source: "export const c = 1;\n",
    },
  };
  for (const [memberDir, member] of Object.entries(members)) {
    const packageDir = join(repoRoot, "packages", memberDir);
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(
      join(packageDir, "deno.json"),
      `${JSON.stringify(member.manifest, null, 2)}\n`,
    );
    await Deno.writeTextFile(join(packageDir, "mod.ts"), member.source);
  }
}

function getDependenciesEnv({
  repoRoot,
  member,
}: {
  repoRoot: string;
  member: string;
}): Record<string, string> {
  return {
    DV_REPO_ROOT: repoRoot,
    DV_PACKAGE_NAME: `@fixture/${member}`,
    DV_PACKAGE_PATH: join(repoRoot, "packages", member),
  };
}

Deno.test("get-dependencies finds a workspace member imported without an import-map entry", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: member a imports member b only through the workspace
    await writeWorkspaceFixture(repoRoot);

    // When: dv asks which candidates a depends on
    const outcome = await runOp({
      op: "get-dependencies",
      env: getDependenciesEnv({ repoRoot, member: "a" }),
      stdin: { candidates: ["@fixture/b", "@fixture/c"] },
    });

    // Then: b is reported (from the module graph) and c is not
    assertEquals(outcome, {
      exitCode: 0,
      response: { ok: true, dependencies: ["@fixture/b"] },
    });
  });
});

Deno.test("get-dependencies unions import-map entries with module-graph edges", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: member a also declares c in its import map, without using it
    await writeWorkspaceFixture(repoRoot);
    await Deno.writeTextFile(
      join(repoRoot, "packages", "a", "deno.json"),
      `${JSON.stringify(
        {
          name: "@fixture/a",
          version: "1.0.0",
          exports: "./mod.ts",
          imports: { "@fixture/c": "jsr:@fixture/c@^1.0.0" },
        },
        null,
        2,
      )}\n`,
    );

    // When: dv asks which candidates a depends on
    const outcome = await runOp({
      op: "get-dependencies",
      env: getDependenciesEnv({ repoRoot, member: "a" }),
      stdin: { candidates: ["@fixture/b", "@fixture/c"] },
    });

    // Then: both the declared and the graph-derived dependency appear
    assertEquals(outcome.response, {
      ok: true,
      dependencies: ["@fixture/b", "@fixture/c"],
    });
  });
});

Deno.test("get-dependencies attributes a module under a nameless nested manifest to the named member above it", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: a reaches b only through a file under b/internal, which
    // carries its own nameless deno.json
    await writeWorkspaceFixture(repoRoot);
    const internalDir = join(repoRoot, "packages", "b", "internal");
    await Deno.mkdir(internalDir);
    await Deno.writeTextFile(join(internalDir, "deno.json"), "{}\n");
    await Deno.writeTextFile(
      join(internalDir, "util.ts"),
      "export const util = 1;\n",
    );
    await Deno.writeTextFile(
      join(repoRoot, "packages", "b", "deno.json"),
      `${JSON.stringify(
        {
          name: "@fixture/b",
          version: "1.0.0",
          exports: { ".": "./mod.ts", "./internal": "./internal/util.ts" },
        },
        null,
        2,
      )}\n`,
    );
    await Deno.writeTextFile(
      join(repoRoot, "packages", "a", "mod.ts"),
      `import { util } from "@fixture/b/internal";\nexport const a = util;\n`,
    );

    // When: dv asks which candidates a depends on
    const outcome = await runOp({
      op: "get-dependencies",
      env: getDependenciesEnv({ repoRoot, member: "a" }),
      stdin: { candidates: ["@fixture/b", "@fixture/c"] },
    });

    // Then: the walk passes the nameless manifest and credits b
    assertEquals(outcome, {
      exitCode: 0,
      response: { ok: true, dependencies: ["@fixture/b"] },
    });
  });
});

Deno.test("get-dependencies reports a leaf member as having no dependencies", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: member b imports no other member
    await writeWorkspaceFixture(repoRoot);

    // When: dv asks which candidates b depends on
    const outcome = await runOp({
      op: "get-dependencies",
      env: getDependenciesEnv({ repoRoot, member: "b" }),
      stdin: { candidates: ["@fixture/a", "@fixture/c"] },
    });

    // Then: the subset is empty — a's edge to b is not reversed
    assertEquals(outcome.response, { ok: true, dependencies: [] });
  });
});

Deno.test("get-dependencies falls back to import-map deps with a warning when the graph is broken", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: member a declares c in its import map, imports b through
    // the workspace, and exports a file that does not exist
    await writeWorkspaceFixture(repoRoot);
    await Deno.writeTextFile(
      join(repoRoot, "packages", "a", "deno.json"),
      `${JSON.stringify(
        {
          name: "@fixture/a",
          version: "1.0.0",
          exports: "./missing.ts",
          imports: { "@fixture/c": "jsr:@fixture/c@^1.0.0" },
        },
        null,
        2,
      )}\n`,
    );

    // When: dv asks which candidates a depends on
    const { outcome, stderr } = await runOpCapturingStderr({
      op: "get-dependencies",
      env: getDependenciesEnv({ repoRoot, member: "a" }),
      stdin: { candidates: ["@fixture/b", "@fixture/c"] },
    });

    // Then: the op succeeds with the import-map deps only, and warns
    // on stderr naming the package and the deno info failure
    assertEquals(outcome, {
      exitCode: 0,
      response: { ok: true, dependencies: ["@fixture/c"] },
    });
    assertStringIncludes(stderr, "warning: @fixture/a:");
    assertStringIncludes(stderr, "missing.ts");
    assertEquals(stderr.includes("\u001b"), false);
  });
});

Deno.test("release skips publishing a package marked publish: false", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a publish: false member, and a publish command that would fail
    await Deno.writeTextFile(
      join(packageDir, "deno.json"),
      `{\n\t"name": "@fixture/app",\n\t"version": "1.0.0",\n\t"publish": false\n}\n`,
    );

    // When: dv fires the release op after tagging it
    const outcome = await runOp({
      op: "release",
      env: {
        ...releaseEnv({ packageDir, packageName: "@fixture/app" }),
        DENO_PLUGIN_PUBLISH_COMMAND: JSON.stringify(FAILING_PUBLISH_COMMAND),
      },
    });

    // Then: the op succeeds because the publish command never ran
    assertEquals(outcome, {
      exitCode: 0,
      response: {
        ok: true,
        published: false,
        message: `@fixture/app@1.0.0 not published: "publish": false in ${join(packageDir, "deno.json")}`,
      },
    });
  });
});

Deno.test("release reports a failed publish as data, not a crash", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a publishable member whose publish command fails
    await Deno.writeTextFile(
      join(packageDir, "deno.json"),
      `{\n\t"name": "@fixture/lib",\n\t"version": "1.0.0"\n}\n`,
    );

    // When: dv fires the release op
    const outcome = await runOp({
      op: "release",
      env: {
        ...releaseEnv({ packageDir, packageName: "@fixture/lib" }),
        DENO_PLUGIN_PUBLISH_COMMAND: JSON.stringify(FAILING_PUBLISH_COMMAND),
      },
    });

    // Then: the op exits 0 with ok:false and the command's stderr
    assertEquals(outcome.exitCode, 0);
    const response = isRecord(outcome.response) ? outcome.response : {};
    assertEquals(response.ok, false);
    assertStringIncludes(String(response.message), "simulated publish failure");
  });
});

Deno.test("release failure messages carry no ANSI escape codes", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a publish command whose stderr Deno would colour
    await Deno.writeTextFile(
      join(packageDir, "deno.json"),
      `{\n\t"name": "@fixture/lib",\n\t"version": "1.0.0"\n}\n`,
    );

    // When: dv fires the release op and the command fails
    const outcome = await runOp({
      op: "release",
      env: {
        ...releaseEnv({ packageDir, packageName: "@fixture/lib" }),
        DENO_PLUGIN_PUBLISH_COMMAND: JSON.stringify(FAILING_PUBLISH_COMMAND),
      },
    });

    // Then: the message dv records (and prints in --json) is plain text
    const response = isRecord(outcome.response) ? outcome.response : {};
    assertEquals(String(response.message).includes("\u001b"), false);
  });
});

Deno.test("release reports a successful publish as published", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a publishable member whose publish command succeeds
    await Deno.writeTextFile(
      join(packageDir, "deno.json"),
      `{\n\t"name": "@fixture/lib",\n\t"version": "1.0.0"\n}\n`,
    );

    // When: dv fires the release op
    const outcome = await runOp({
      op: "release",
      env: {
        ...releaseEnv({ packageDir, packageName: "@fixture/lib" }),
        DENO_PLUGIN_PUBLISH_COMMAND: JSON.stringify(["deno", "eval", ""]),
      },
    });

    // Then: the op reports the package as published
    assertEquals(outcome, {
      exitCode: 0,
      response: {
        ok: true,
        published: true,
        message: "published @fixture/lib@1.0.0 to JSR",
      },
    });
  });
});

// Stands in for a `deno publish` the registry rejects. An uncaught
// error makes Deno print a coloured "error:" line unless NO_COLOR.
const FAILING_PUBLISH_COMMAND = [
  "deno",
  "eval",
  "throw new Error('simulated publish failure');",
];

function releaseEnv({
  packageDir,
  packageName,
}: {
  packageDir: string;
  packageName: string;
}): Record<string, string> {
  return {
    DV_PACKAGE_NAME: packageName,
    DV_PACKAGE_PATH: packageDir,
    DV_NEW_VERSION: "1.0.0",
    DV_GIT_TAG: `${packageName}@1.0.0`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
