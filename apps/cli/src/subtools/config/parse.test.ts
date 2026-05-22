import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { loadConfig } from "./parse.ts";

interface WithConfigDirectoryArgs {
  filesByName: Record<string, string>;
  testBody: (configDirectory: string) => Promise<void>;
}

async function withConfigDirectory(
  args: WithConfigDirectoryArgs,
): Promise<void> {
  const configDirectory = await Deno.makeTempDir({ prefix: "dv-config-" });
  try {
    for (const [fileName, fileBody] of Object.entries(args.filesByName)) {
      await Deno.writeTextFile(join(configDirectory, fileName), fileBody);
    }
    await args.testBody(configDirectory);
  } finally {
    await Deno.remove(configDirectory, { recursive: true });
  }
}

Deno.test("loadConfig on an empty file falls back to documented defaults", async () => {
  await withConfigDirectory({
    filesByName: { "config.yaml": "" },
    testBody: async (configDirectory) => {
      // Given an empty config.yaml
      const configFilePath = join(configDirectory, "config.yaml");

      // When loadConfig parses it
      const resolvedConfig = await loadConfig(configFilePath);

      // Then every section carries the default values from defaults()
      assertEquals(resolvedConfig.discovery.plugins, []);
      assertEquals(resolvedConfig.discovery.useGitignore, true);
      assertEquals(resolvedConfig.tagging.format, "{package}@{version}");
      assertEquals(resolvedConfig.changelog.format, "keep-a-changelog");
      assertEquals(resolvedConfig.git.requireCleanTree, true);
      assertEquals(resolvedConfig.safety.dryRunByDefault, false);
    },
  });
});

Deno.test("loadConfig accepts a single-string discovery match", async () => {
  await withConfigDirectory({
    filesByName: {
      "config.yaml": `
discovery:
  plugins:
    - match: "packages/*"
      use: ./plugins/x
`,
    },
    testBody: async (configDirectory) => {
      // Given a config with one plugin and a single-string match
      const configFilePath = join(configDirectory, "config.yaml");

      // When loadConfig parses it
      const resolvedConfig = await loadConfig(configFilePath);

      // Then the plugin assignment is preserved as-typed
      assertEquals(resolvedConfig.discovery.plugins.length, 1);
      assertEquals(resolvedConfig.discovery.plugins[0]?.match, "packages/*");
      assertEquals(resolvedConfig.discovery.plugins[0]?.use, "./plugins/x");
    },
  });
});

Deno.test("loadConfig accepts a list-of-globs match with negation and a timeout", async () => {
  await withConfigDirectory({
    filesByName: {
      "config.yaml": `
discovery:
  plugins:
    - match:
        - "packages/*"
        - "!packages/legacy"
      use: ./plugins/x
      timeout: 5m
`,
    },
    testBody: async (configDirectory) => {
      // Given a list match with one positive glob, one negation, and a timeout
      const configFilePath = join(configDirectory, "config.yaml");

      // When loadConfig parses it
      const resolvedConfig = await loadConfig(configFilePath);

      // Then the array form, the negation, and the timeout all survive
      assertEquals(resolvedConfig.discovery.plugins[0]?.match, [
        "packages/*",
        "!packages/legacy",
      ]);
      assertEquals(resolvedConfig.discovery.plugins[0]?.timeout, "5m");
    },
  });
});

Deno.test("loadConfig rejects an unknown top-level key (typo guard)", async () => {
  await withConfigDirectory({
    filesByName: { "config.yaml": "bogus: 1\n" },
    testBody: async (configDirectory) => {
      // Given a config with a top-level key that is not in the schema
      const configFilePath = join(configDirectory, "config.yaml");

      // When loadConfig parses it
      // Then it rejects with a ConfigError mentioning the offending key
      await assertRejects(() => loadConfig(configFilePath), DvError, "bogus");
    },
  });
});

Deno.test("loadConfig rejects an unknown nested key (typo guard)", async () => {
  await withConfigDirectory({
    filesByName: {
      "config.yaml": `
discovery:
  plugins: []
  typo: 1
`,
    },
    testBody: async (configDirectory) => {
      // Given a discovery section with an unknown nested key
      const configFilePath = join(configDirectory, "config.yaml");

      // When loadConfig parses it
      // Then ConfigError reports the bad key path
      await assertRejects(() => loadConfig(configFilePath), DvError, "typo");
    },
  });
});

Deno.test("loadConfig rejects a plugin assignment missing the required 'match'", async () => {
  await withConfigDirectory({
    filesByName: {
      "config.yaml": `
discovery:
  plugins:
    - use: ./plugins/x
`,
    },
    testBody: async (configDirectory) => {
      // Given a plugin entry that omits the required `match` field
      const configFilePath = join(configDirectory, "config.yaml");

      // When loadConfig parses it
      // Then ConfigError surfaces the missing field
      await assertRejects(() => loadConfig(configFilePath), DvError, "match");
    },
  });
});

Deno.test("loadConfig walks extends chains, letting later layers override earlier ones", async () => {
  await withConfigDirectory({
    filesByName: {
      "base.yaml": `
discovery:
  plugins:
    - match: "packages/*"
      use: ./plugins/base
tagging:
  format: "{package}-v{version}"
`,
      "config.yaml": `
extends: ./base.yaml
tagging:
  format: "{version}"
`,
    },
    testBody: async (configDirectory) => {
      // Given a local config that extends a base, overriding `tagging.format`
      const configFilePath = join(configDirectory, "config.yaml");

      // When loadConfig parses it
      const resolvedConfig = await loadConfig(configFilePath);

      // Then base values flow through unless the local layer overrides them
      assertEquals(resolvedConfig.discovery.plugins.length, 1);
      assertEquals(resolvedConfig.discovery.plugins[0]?.use, "./plugins/base");
      assertEquals(resolvedConfig.tagging.format, "{version}");
    },
  });
});

Deno.test("loadConfig rejects an extends chain that loops back on itself", async () => {
  await withConfigDirectory({
    filesByName: {
      "a.yaml": "extends: ./b.yaml\n",
      "b.yaml": "extends: ./a.yaml\n",
    },
    testBody: async (configDirectory) => {
      // Given two configs that extend each other
      const aConfigFilePath = join(configDirectory, "a.yaml");

      // When loadConfig is called on either side
      // Then ConfigError flags the cycle
      await assertRejects(() => loadConfig(aConfigFilePath), DvError, "cycle");
    },
  });
});

Deno.test("loadConfig surfaces a structured config-not-found error when the file is missing", async () => {
  // Given a path that does not exist
  const missingConfigPath = "/tmp/definitely-not-here-XQ7/config.yaml";

  // When loadConfig is called
  // Then it rejects with ConfigError carrying the config-not-found message
  await assertRejects(
    () => loadConfig(missingConfigPath),
    DvError,
    "config not found",
  );
});
