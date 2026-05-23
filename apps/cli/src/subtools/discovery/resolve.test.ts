import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { resolvePlugin } from "./resolve.ts";

// Targeted tests for the three reference arms of resolvePlugin —
// path / builtin / command. The path arm is covered indirectly by
// every integration test that scaffolds a fixture plugin, but the
// builtin and command arms had no coverage before the use-key
// redesign. Lock in the new behavior here so a future refactor
// can't quietly regress the "exactly one of" discrimination.

interface WithExecutableArgs {
  testBody: (binDirectory: string) => Promise<void>;
}

// Creates a temp directory with one executable shell script inside,
// then runs testBody with the bin directory's path. Used to set up
// fake $PATH entries for the command: arm.
async function withExecutable(args: WithExecutableArgs): Promise<void> {
  const binDirectory = await Deno.makeTempDir({ prefix: "dv-resolve-bin-" });
  try {
    const executablePath = join(binDirectory, "fake-plugin");
    await Deno.writeTextFile(
      executablePath,
      "#!/usr/bin/env bash\necho '{}'\n",
    );
    await Deno.chmod(executablePath, 0o755);
    await args.testBody(binDirectory);
  } finally {
    await Deno.remove(binDirectory, { recursive: true });
  }
}

Deno.test("resolvePlugin(path) resolves a local file plugin against the repo root", async () => {
  // Given a relative path plugin at <repoRoot>/scripts/my-plugin
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-resolve-path-" });
  try {
    const scriptDirectory = join(repoRootPath, "scripts");
    await Deno.mkdir(scriptDirectory);
    const executablePath = join(scriptDirectory, "my-plugin");
    await Deno.writeTextFile(executablePath, "#!/usr/bin/env bash\nexit 0\n");
    await Deno.chmod(executablePath, 0o755);

    // When resolvePlugin runs with a path reference
    const resolvedPlugin = await resolvePlugin({
      pluginReference: { path: "./scripts/my-plugin" },
      repoRootPath,
    });

    // Then the resolver expanded the relative path against the repo
    // root and classified it as a single-file plugin
    assertEquals(resolvedPlugin.kind, "single");
    assertEquals(resolvedPlugin.path, executablePath);
  } finally {
    await Deno.remove(repoRootPath, { recursive: true });
  }
});

Deno.test("resolvePlugin(path) classifies a directory as a 'dir' plugin", async () => {
  // Given a directory at <repoRoot>/plugins/my-dir-plugin/
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-resolve-dir-" });
  try {
    const directoryPluginPath = join(repoRootPath, "plugins", "my-dir-plugin");
    await Deno.mkdir(directoryPluginPath, { recursive: true });

    // When resolvePlugin runs
    const resolvedPlugin = await resolvePlugin({
      pluginReference: { path: "./plugins/my-dir-plugin" },
      repoRootPath,
    });

    // Then the resolver classifies it as a directory plugin (one
    // executable per Op layout)
    assertEquals(resolvedPlugin.kind, "dir");
    assertEquals(resolvedPlugin.path, directoryPluginPath);
  } finally {
    await Deno.remove(repoRootPath, { recursive: true });
  }
});

Deno.test("resolvePlugin(path) errors with 'plugin-not-found' when the file doesn't exist", async () => {
  // Given a repo root with no such path
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-resolve-miss-" });
  try {
    // When resolvePlugin runs
    // Then DvError carries the documented code
    const caughtError = await assertRejects(
      () =>
        resolvePlugin({
          pluginReference: { path: "./does-not-exist" },
          repoRootPath,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "plugin-not-found");
  } finally {
    await Deno.remove(repoRootPath, { recursive: true });
  }
});

Deno.test("resolvePlugin(builtin) always errors in v1 — no first-party plugins ship", async () => {
  // Given any repo root
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-resolve-bi-" });
  try {
    // When resolvePlugin runs with a builtin reference
    // Then DvError surfaces with 'plugin-not-found' (the builtin
    // registry is empty in v1; the message explains the situation)
    const caughtError = await assertRejects(
      () =>
        resolvePlugin({
          pluginReference: { builtin: "cargo" },
          repoRootPath,
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "plugin-not-found");
  } finally {
    await Deno.remove(repoRootPath, { recursive: true });
  }
});

Deno.test("resolvePlugin(command) resolves a binary found on $PATH", async () => {
  // Given a fake-plugin executable in a temp directory
  await withExecutable({
    testBody: async (binDirectory) => {
      // When $PATH is set to that directory and we resolve a command
      // reference to fake-plugin
      const originalPath = Deno.env.get("PATH");
      Deno.env.set("PATH", binDirectory);
      try {
        const resolvedPlugin = await resolvePlugin({
          pluginReference: { command: "fake-plugin" },
          repoRootPath: "/unused-by-command-arm",
        });

        // Then the resolver finds it on PATH and returns its absolute
        // path. The command arm always returns a single-file plugin —
        // directory plugins are a path-arm concept.
        assertEquals(resolvedPlugin.kind, "single");
        assertEquals(resolvedPlugin.path, join(binDirectory, "fake-plugin"));
      } finally {
        if (originalPath !== undefined) {
          Deno.env.set("PATH", originalPath);
        }
      }
    },
  });
});

Deno.test("resolvePlugin(command) errors with 'plugin-command-not-found' when nothing on $PATH matches", async () => {
  // Given a $PATH that doesn't contain the requested command
  const emptyBinDirectory = await Deno.makeTempDir({ prefix: "dv-empty-" });
  const originalPath = Deno.env.get("PATH");
  try {
    Deno.env.set("PATH", emptyBinDirectory);
    // When resolvePlugin runs
    // Then DvError surfaces with the dedicated 'plugin-command-not-found'
    // code (distinct from plugin-not-found, which is for the path arm)
    const caughtError = await assertRejects(
      () =>
        resolvePlugin({
          pluginReference: { command: "definitely-not-installed-xyz" },
          repoRootPath: "/unused",
        }),
      DvError,
    );
    assertEquals(caughtError.kind.code, "plugin-command-not-found");
  } finally {
    if (originalPath !== undefined) {
      Deno.env.set("PATH", originalPath);
    }
    await Deno.remove(emptyBinDirectory, { recursive: true });
  }
});

Deno.test("resolvePlugin(command) rejects path-shaped names early (user meant path:)", async () => {
  // Given a command reference whose value looks like a path
  // When resolvePlugin runs
  // Then DvError points the user at use.path — the command arm is
  // for $PATH lookups only, so accepting a path-shaped name would
  // silently miss and confuse
  const caughtError = await assertRejects(
    () =>
      resolvePlugin({
        pluginReference: { command: "./scripts/my-plugin" },
        repoRootPath: "/unused",
      }),
    DvError,
  );
  assertEquals(caughtError.kind.code, "plugin-command-not-found");
});

Deno.test("resolvePlugin(run) tokenizes the invocation string and produces an 'invocation' plugin", async () => {
  // Given a `run:` reference of the shape Sekhmet-style users
  // want — an interpreter plus a JSR specifier
  const resolvedPlugin = await resolvePlugin({
    pluginReference: { run: "deno run -A jsr:@sekhmet/some-plugin" },
    repoRootPath: "/unused-by-run-arm",
  });

  // Then the result is an 'invocation' kind carrying the first
  // token as executable, the rest as baseArgs, and the original
  // string as the display path for error context
  if (resolvedPlugin.kind !== "invocation") {
    throw new Error(`expected kind 'invocation', got '${resolvedPlugin.kind}'`);
  }
  assertEquals(resolvedPlugin.executable, "deno");
  assertEquals(resolvedPlugin.baseArgs, [
    "run",
    "-A",
    "jsr:@sekhmet/some-plugin",
  ]);
  assertEquals(resolvedPlugin.path, "deno run -A jsr:@sekhmet/some-plugin");
});

Deno.test("resolvePlugin(run) preserves quoted args containing spaces", async () => {
  // Given a run reference where one arg legitimately contains
  // spaces (e.g. a path argument the user wants to pass static)
  const resolvedPlugin = await resolvePlugin({
    pluginReference: {
      run: 'python -m my_plugin --root "/repos/path with spaces"',
    },
    repoRootPath: "/unused",
  });

  // Then the tokenizer preserved the quoted span as a single arg
  if (resolvedPlugin.kind !== "invocation") {
    throw new Error(`expected kind 'invocation', got '${resolvedPlugin.kind}'`);
  }
  assertEquals(resolvedPlugin.baseArgs, [
    "-m",
    "my_plugin",
    "--root",
    "/repos/path with spaces",
  ]);
});

Deno.test("resolvePlugin(run) errors with 'plugin-run-parse' on malformed quoting", async () => {
  // Given a run reference with an unterminated quote — the
  // tokenizer rejects this, and the resolver maps to a targeted
  // DvError pointing at the run: value
  const caughtError = await assertRejects(
    () =>
      resolvePlugin({
        pluginReference: { run: "deno run 'unclosed quote" },
        repoRootPath: "/unused",
      }),
    DvError,
  );
  assertEquals(caughtError.kind.code, "plugin-run-parse");
});
