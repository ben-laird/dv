import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

// Black-box tests for the example Deno plugin: each test runs the
// plugin the way dv does (an Op name in argv, env vars, optional
// JSON on stdin) and checks the JSON response plus any file edits.

const pluginEntryPath = fromFileUrl(import.meta.resolve("./main.ts"));

interface OpOutcome {
  exitCode: number;
  response: unknown;
}

async function runOp({
  op,
  env,
  stdin,
}: {
  op: string;
  env: Record<string, string>;
  stdin?: unknown;
}): Promise<OpOutcome> {
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
  return {
    exitCode: output.code,
    response: stdoutText === "" ? undefined : JSON.parse(stdoutText),
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
