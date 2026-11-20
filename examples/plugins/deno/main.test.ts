import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { packagesInModuleGraph } from "./main.ts";

// Black-box tests for the example Deno plugin: each test runs the
// plugin the way dv does (an Op name in argv, env vars, optional
// JSON on stdin) and checks the JSON response plus any file edits.
// The deadline test imports one helper directly to pass a short budget.

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
  const child = new Deno.Command(Deno.execPath(), {
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

Deno.test("a failing op writes its error to stderr as well as stdout", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a directory with no manifest

    // When: dv asks for its version
    const { outcome, stderr } = await runOpCapturingStderr({
      op: "read-version",
      env: { DV_PACKAGE_PATH: packageDir },
    });

    // Then: the op exits non-zero with the error on both streams, so
    // dv (which reports stderr) can show the user why
    assertEquals(outcome.exitCode, 1);
    const response = isRecord(outcome.response) ? outcome.response : {};
    assertEquals(response.ok, false);
    assertStringIncludes(String(response.error), "no deno.json or deno.jsonc");
    assertStringIncludes(stderr, "error: no deno.json or deno.jsonc");
  });
});

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

Deno.test("write-version skips over strings with escapes and brackets", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a string ahead of `version` holding escaped quotes,
    // backslashes, brackets and comment-like text
    const manifestPath = join(packageDir, "deno.json");
    const original = `{\n\t"name": "@fixture/escapes",\n\t"description": "a \\"quoted\\" \\\\ path }{ ][ // not a comment",\n\t"version": "1.0.0"\n}\n`;
    await Deno.writeTextFile(manifestPath, original);

    // When: dv writes a new version
    const outcome = await runOp({
      op: "write-version",
      env: { DV_PACKAGE_PATH: packageDir, DV_NEW_VERSION: "1.0.1" },
    });

    // Then: only the version value changed
    assertEquals(outcome, { exitCode: 0, response: { ok: true } });
    assertEquals(
      await Deno.readTextFile(manifestPath),
      original.replace('"1.0.0"', '"1.0.1"'),
    );
  });
});

Deno.test("write-version edits the top-level version, not a nested one", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a nested `version` key ahead of the top-level one
    const manifestPath = join(packageDir, "deno.json");
    const original = `{\n\t"name": "@fixture/nested",\n\t"tasks": { "version": "deno run version.ts" },\n\t"version": "1.0.0"\n}\n`;
    await Deno.writeTextFile(manifestPath, original);

    // When: dv writes a new version
    const outcome = await runOp({
      op: "write-version",
      env: { DV_PACKAGE_PATH: packageDir, DV_NEW_VERSION: "2.0.0" },
    });

    // Then: the task is untouched and the top-level version moved
    assertEquals(outcome, { exitCode: 0, response: { ok: true } });
    assertEquals(
      await Deno.readTextFile(manifestPath),
      original.replace('"1.0.0"', '"2.0.0"'),
    );
  });
});

Deno.test("write-version inserts a top-level version when only a nested one exists", async () => {
  await withTempDir(async (packageDir) => {
    // Given: no top-level version, but a nested `version` key
    const manifestPath = join(packageDir, "deno.json");
    await Deno.writeTextFile(
      manifestPath,
      `{\n\t"name": "@fixture/nested",\n\t"tasks": { "version": "deno run version.ts" }\n}\n`,
    );

    // When: dv writes the first version
    const outcome = await runOp({
      op: "write-version",
      env: { DV_PACKAGE_PATH: packageDir, DV_NEW_VERSION: "0.1.0" },
    });

    // Then: a top-level version is added after name; the task is untouched
    assertEquals(outcome, { exitCode: 0, response: { ok: true } });
    assertEquals(
      await Deno.readTextFile(manifestPath),
      `{\n\t"name": "@fixture/nested",\n\t"version": "0.1.0",\n\t"tasks": { "version": "deno run version.ts" }\n}\n`,
    );
  });
});

Deno.test("write-version keeps CRLF line endings when editing and inserting", async () => {
  await withTempDir(async (packageDir) => {
    // Given: two CRLF manifests, one with a version and one without
    const withVersionDir = join(packageDir, "with");
    const withoutVersionDir = join(packageDir, "without");
    await Deno.mkdir(withVersionDir);
    await Deno.mkdir(withoutVersionDir);
    const withVersion = `{\r\n\t"name": "@fixture/crlf",\r\n\t"version": "1.0.0"\r\n}\r\n`;
    await Deno.writeTextFile(join(withVersionDir, "deno.json"), withVersion);
    await Deno.writeTextFile(
      join(withoutVersionDir, "deno.json"),
      `{\r\n\t"name": "@fixture/crlf",\r\n\t"exports": "./mod.ts"\r\n}\r\n`,
    );

    // When: dv writes a version into each
    for (const targetDir of [withVersionDir, withoutVersionDir]) {
      await runOp({
        op: "write-version",
        env: { DV_PACKAGE_PATH: targetDir, DV_NEW_VERSION: "1.2.0" },
      });
    }

    // Then: both files keep CRLF, including the inserted line
    assertEquals(
      await Deno.readTextFile(join(withVersionDir, "deno.json")),
      withVersion.replace('"1.0.0"', '"1.2.0"'),
    );
    assertEquals(
      await Deno.readTextFile(join(withoutVersionDir, "deno.json")),
      `{\r\n\t"name": "@fixture/crlf",\r\n\t"version": "1.2.0",\r\n\t"exports": "./mod.ts"\r\n}\r\n`,
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

Deno.test("get-dependencies matches jsr:/npm: import-map entries and ignores registry imports in source", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: a maps b through npm: and c through jsr:, and its source
    // also pulls registry modules that are never workspace members
    await writeWorkspaceFixture(repoRoot);
    await Deno.writeTextFile(
      join(repoRoot, "packages", "a", "deno.json"),
      `${JSON.stringify(
        {
          name: "@fixture/a",
          version: "1.0.0",
          exports: "./mod.ts",
          imports: {
            "@fixture/b": "npm:@fixture/b@^1.0.0",
            "@fixture/c": "jsr:@fixture/c@^1.0.0",
            "@std/path": "jsr:@std/path@^1",
          },
        },
        null,
        2,
      )}\n`,
    );
    await Deno.writeTextFile(
      join(repoRoot, "packages", "a", "mod.ts"),
      `import { join } from "jsr:@std/path@^1";\nimport chalk from "npm:chalk@5";\nexport const a = join("x") + String(chalk);\n`,
    );

    // When: dv asks which candidates a depends on
    const { outcome, stderr } = await runOpCapturingStderr({
      op: "get-dependencies",
      env: getDependenciesEnv({ repoRoot, member: "a" }),
      stdin: { candidates: ["@fixture/b", "@fixture/c"] },
    });

    // Then: both mapped members are reported, registry modules are
    // skipped without tripping the broken-graph fallback
    assertEquals(outcome, {
      exitCode: 0,
      response: { ok: true, dependencies: ["@fixture/b", "@fixture/c"] },
    });
    assertEquals(stderr.includes("warning"), false);
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

// A fake `deno` on PATH that intercepts only `deno publish`: it records
// its argv and succeeds or fails on cue, colouring its error unless
// NO_COLOR is set (as real Deno does). Every other subcommand execs the
// real deno. runOp starts the plugin via Deno.execPath(), so only the
// plugin's own `deno publish` call can reach the fake.
interface FakeDeno {
  env: Record<string, string>;
  argvLogPath: string;
}

async function installFakeDeno({
  rootDir,
  publishOutcome,
}: {
  rootDir: string;
  publishOutcome: "succeed" | "fail";
}): Promise<FakeDeno> {
  const binDir = join(rootDir, "fake-bin");
  await Deno.mkdir(binDir);
  const argvLogPath = join(rootDir, "publish-argv.log");
  const publishBehavior = fakePublishBehavior(publishOutcome);
  const fakeDenoPath = join(binDir, "deno");
  await Deno.writeTextFile(
    fakeDenoPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "publish" ]; then',
      `  printf '%s\\n' "$@" > '${argvLogPath}'`,
      publishBehavior,
      "fi",
      `exec '${Deno.execPath()}' "$@"`,
      "",
    ].join("\n"),
  );
  await Deno.chmod(fakeDenoPath, 0o755);
  return {
    env: { PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}` },
    argvLogPath,
  };
}

function fakePublishBehavior(publishOutcome: "succeed" | "fail"): string {
  if (publishOutcome === "succeed") return "  exit 0";
  return [
    '  if [ -z "$NO_COLOR" ]; then',
    "    printf '\\033[31merror\\033[0m: simulated publish failure\\n' >&2",
    "  else",
    "    printf 'error: simulated publish failure\\n' >&2",
    "  fi",
    "  exit 1",
  ].join("\n");
}

async function readPublishArgv(
  argvLogPath: string,
): Promise<string[] | undefined> {
  try {
    return (await Deno.readTextFile(argvLogPath)).trimEnd().split("\n");
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return undefined;
    throw caughtError;
  }
}

async function writePublishableManifest(packageDir: string): Promise<void> {
  await Deno.writeTextFile(
    join(packageDir, "deno.json"),
    `{\n\t"name": "@fixture/lib",\n\t"version": "1.0.0"\n}\n`,
  );
}

Deno.test("release skips publishing a package marked publish: false", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a publish: false member, and a deno publish that would fail
    await Deno.writeTextFile(
      join(packageDir, "deno.json"),
      `{\n\t"name": "@fixture/app",\n\t"version": "1.0.0",\n\t"publish": false\n}\n`,
    );
    const fakeDeno = await installFakeDeno({
      rootDir: packageDir,
      publishOutcome: "fail",
    });

    // When: dv fires the release op after tagging it
    const outcome = await runOp({
      op: "release",
      env: {
        ...releaseEnv({ packageDir, packageName: "@fixture/app" }),
        ...fakeDeno.env,
      },
    });

    // Then: the op succeeds and deno publish was never run
    assertEquals(outcome, {
      exitCode: 0,
      response: {
        ok: true,
        published: false,
        message: `@fixture/app@1.0.0 not published: "publish": false in ${join(packageDir, "deno.json")}`,
      },
    });
    assertEquals(await readPublishArgv(fakeDeno.argvLogPath), undefined);
  });
});

Deno.test("release runs deno publish --allow-dirty --quiet and reports success", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a publishable member and a deno publish that succeeds
    await writePublishableManifest(packageDir);
    const fakeDeno = await installFakeDeno({
      rootDir: packageDir,
      publishOutcome: "succeed",
    });

    // When: dv fires the release op
    const outcome = await runOp({
      op: "release",
      env: {
        ...releaseEnv({ packageDir, packageName: "@fixture/lib" }),
        ...fakeDeno.env,
      },
    });

    // Then: the real default argv ran and the package reads as published
    assertEquals(await readPublishArgv(fakeDeno.argvLogPath), [
      "publish",
      "--allow-dirty",
      "--quiet",
    ]);
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

Deno.test("release reports a failed publish as plain-text data, not a crash", async () => {
  await withTempDir(async (packageDir) => {
    // Given: a publishable member whose deno publish fails, colouring
    // its error unless NO_COLOR is set
    await writePublishableManifest(packageDir);
    const fakeDeno = await installFakeDeno({
      rootDir: packageDir,
      publishOutcome: "fail",
    });

    // When: dv fires the release op
    const outcome = await runOp({
      op: "release",
      env: {
        ...releaseEnv({ packageDir, packageName: "@fixture/lib" }),
        ...fakeDeno.env,
      },
    });

    // Then: the op exits 0 with ok:false, quoting the error with no
    // ANSI escapes (the message lands in dv release --json)
    assertEquals(outcome.exitCode, 0);
    const response = isRecord(outcome.response) ? outcome.response : {};
    assertEquals(response.ok, false);
    assertStringIncludes(
      String(response.message),
      "error: simulated publish failure",
    );
    assertEquals(String(response.message).includes("\u001b"), false);
  });
});

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

Deno.test("the module-graph walk returns at its deadline even if deno's pipes stay open", async () => {
  await withTempDir(async (rootDir) => {
    // Given: a `deno` wrapper on PATH that never execs: it backgrounds
    // a long-lived grandchild that inherits stdout/stderr, then waits
    const binDir = join(rootDir, "slow-bin");
    await Deno.mkdir(binDir);
    const grandchildPidPath = join(rootDir, "grandchild.pid");
    const slowDenoPath = join(binDir, "deno");
    await Deno.writeTextFile(
      slowDenoPath,
      `#!/bin/sh\nsleep 30 &\necho $! > '${grandchildPidPath}'\nwait\n`,
    );
    await Deno.chmod(slowDenoPath, 0o755);
    const originalPath = Deno.env.get("PATH");
    Deno.env.set("PATH", `${binDir}:${originalPath ?? ""}`);

    // When: the walk runs with a 500ms budget
    const startedAt = performance.now();
    let result: Awaited<ReturnType<typeof packagesInModuleGraph>>;
    try {
      result = await packagesInModuleGraph({
        packageDir: rootDir,
        exports: "./mod.ts",
        budgetMs: 500,
      });
    } finally {
      if (originalPath === undefined) {
        Deno.env.delete("PATH");
      } else {
        Deno.env.set("PATH", originalPath);
      }
      await killRecordedProcess(grandchildPidPath);
    }
    const elapsedMs = performance.now() - startedAt;

    // Then: it gives up promptly, reporting the graph as unavailable
    // (so the op falls back) instead of waiting for the grandchild
    assertEquals(elapsedMs < 5_000, true, `took ${elapsedMs}ms`);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.error.kind, "graph-unavailable");
      assertStringIncludes(result.error.reason, "500ms budget");
    }
  });
});

// Kills the process whose pid the slow wrapper recorded. The wrapper
// may never have run (or the process may already be gone), so both
// the missing file and a dead pid are tolerated.
async function killRecordedProcess(pidPath: string): Promise<void> {
  let pidText: string;
  try {
    pidText = await Deno.readTextFile(pidPath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return;
    throw caughtError;
  }
  const pid = Number(pidText.trim());
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    Deno.kill(pid, "SIGKILL");
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return;
    throw caughtError;
  }
}

// Runs get-dependencies for member a with `deno` on PATH replaced by
// `fakeDenoScript` (or with no `deno` at all when it is undefined).
async function getDependenciesWithFakeDeno({
  repoRoot,
  fakeDenoScript,
}: {
  repoRoot: string;
  fakeDenoScript: string | undefined;
}): Promise<{ outcome: OpOutcome; stderr: string }> {
  const binDir = join(repoRoot, "fake-bin");
  await Deno.mkdir(binDir);
  if (fakeDenoScript !== undefined) {
    const fakeDenoPath = join(binDir, "deno");
    await Deno.writeTextFile(fakeDenoPath, fakeDenoScript);
    await Deno.chmod(fakeDenoPath, 0o755);
  }
  return await runOpCapturingStderr({
    op: "get-dependencies",
    env: { ...getDependenciesEnv({ repoRoot, member: "a" }), PATH: binDir },
    stdin: { candidates: ["@fixture/b"] },
  });
}

Deno.test("get-dependencies fails, without falling back, when deno cannot be started", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: a workspace, and a PATH with no deno on it
    await writeWorkspaceFixture(repoRoot);

    // When: dv asks which candidates a depends on
    const { outcome, stderr } = await getDependenciesWithFakeDeno({
      repoRoot,
      fakeDenoScript: undefined,
    });

    // Then: the op fails with a structured error, not a warning
    assertEquals(outcome.exitCode, 1);
    const response = isRecord(outcome.response) ? outcome.response : {};
    assertEquals(response.ok, false);
    assertStringIncludes(String(response.error), "cannot run deno info");
    assertEquals(stderr.includes("warning"), false);
  });
});

Deno.test("get-dependencies fails, without falling back, when deno info prints non-JSON", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: a deno that exits 0 but prints something other than JSON
    await writeWorkspaceFixture(repoRoot);

    // When: dv asks which candidates a depends on
    const { outcome } = await getDependenciesWithFakeDeno({
      repoRoot,
      fakeDenoScript: "#!/bin/sh\necho 'not a module graph'\n",
    });

    // Then: the op fails with a structured error
    assertEquals(outcome.exitCode, 1);
    const response = isRecord(outcome.response) ? outcome.response : {};
    assertStringIncludes(String(response.error), "printed invalid JSON");
  });
});

Deno.test("get-dependencies fails, without falling back, when deno info lists no modules", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: a deno whose graph JSON has an empty module list
    await writeWorkspaceFixture(repoRoot);

    // When: dv asks which candidates a depends on
    const { outcome } = await getDependenciesWithFakeDeno({
      repoRoot,
      fakeDenoScript: `#!/bin/sh\necho '{"roots":[],"modules":[]}'\n`,
    });

    // Then: the op fails with a structured error
    assertEquals(outcome.exitCode, 1);
    const response = isRecord(outcome.response) ? outcome.response : {};
    assertStringIncludes(String(response.error), "listed no modules");
  });
});

Deno.test("get-dependencies falls back with a warning on a per-module load error", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: a deno whose graph carries a local module error and exits
    // 0, as real deno info does for an unloadable entry point
    await writeWorkspaceFixture(repoRoot);
    const graphWithError = JSON.stringify({
      roots: ["file:///gen/mod.ts"],
      modules: [{ specifier: "file:///gen/mod.ts", error: "Module not found" }],
    });

    // When: dv asks which candidates a depends on
    const { outcome, stderr } = await getDependenciesWithFakeDeno({
      repoRoot,
      fakeDenoScript: `#!/bin/sh\necho '${graphWithError}'\n`,
    });

    // Then: the op succeeds with the (empty) import-map answer and warns
    assertEquals(outcome, {
      exitCode: 0,
      response: { ok: true, dependencies: [] },
    });
    assertStringIncludes(stderr, "warning: @fixture/a:");
    assertStringIncludes(stderr, "Module not found");
  });
});

Deno.test("get-dependencies fails, without falling back, when deno info exits non-zero", async () => {
  await withTempDir(async (repoRoot) => {
    // Given: a deno whose info run exits non-zero, as on a malformed config
    await writeWorkspaceFixture(repoRoot);

    // When: dv asks which candidates a depends on
    const { outcome, stderr } = await getDependenciesWithFakeDeno({
      repoRoot,
      fakeDenoScript: "#!/bin/sh\necho 'error: invalid config' >&2\nexit 1\n",
    });

    // Then: the op fails with a structured error, not a warning
    assertEquals(outcome.exitCode, 1);
    const response = isRecord(outcome.response) ? outcome.response : {};
    assertStringIncludes(String(response.error), "invalid config");
    assertEquals(stderr.includes("warning"), false);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
