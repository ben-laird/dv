import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import type { Config } from "../../domain/config.ts";
import { ConfigError } from "../../domain/errors.ts";
import { defaults } from "../config/defaults.ts";
import { discoverPackages } from "./mod.ts";

const BASH_PLUGIN_PREAMBLE = `#!/usr/bin/env bash
set -euo pipefail
`;

interface WithBashPluginArgs {
  pluginShellScript: string;
  testBody: (testRepoRoot: string) => Promise<void>;
  pluginFilename?: string;
}

async function withBashPlugin(args: WithBashPluginArgs): Promise<void> {
  const testRepoRoot = await Deno.makeTempDir({ prefix: "dv-disco-" });
  try {
    const pluginExecutablePath = join(
      testRepoRoot,
      args.pluginFilename ?? "plugin",
    );
    await Deno.writeTextFile(
      pluginExecutablePath,
      BASH_PLUGIN_PREAMBLE + args.pluginShellScript,
    );
    await Deno.chmod(pluginExecutablePath, 0o755);
    await args.testBody(testRepoRoot);
  } finally {
    await Deno.remove(testRepoRoot, { recursive: true });
  }
}

interface ConfigWithSinglePluginArgs {
  pluginUseString: string;
  matchGlob: string | string[];
}

function configWithSinglePlugin(args: ConfigWithSinglePluginArgs): Config {
  const builtConfig = defaults();
  builtConfig.discovery.plugins = [
    { match: args.matchGlob, use: args.pluginUseString },
  ];
  return builtConfig;
}

Deno.test("discoverPackages collects every package the discover op emits", async () => {
  await withBashPlugin({
    pluginShellScript: `
echo '{"packages":[{"name":"core","path":"packages/core"},{"name":"util","path":"packages/util"}]}'
`,
    testBody: async (testRepoRoot) => {
      // Given a config with one plugin matching `packages/*`
      const config = configWithSinglePlugin({
        pluginUseString: "./plugin",
        matchGlob: "packages/*",
      });

      // When discoverPackages runs
      const discoveredPackages = await discoverPackages({
        config,
        repoRootPath: testRepoRoot,
      });

      // Then every package the plugin emitted is returned and tagged with that plugin
      const discoveredNames = discoveredPackages
        .map((discoveredPackage) => discoveredPackage.name)
        .sort();
      assertEquals(discoveredNames, ["core", "util"]);
      assertEquals(
        discoveredPackages.every((p) => p.plugin === "./plugin"),
        true,
      );
    },
  });
});

Deno.test("discoverPackages applies '!'-prefixed negations after the plugin responds", async () => {
  await withBashPlugin({
    pluginShellScript: `
case "$DV_DISCOVER_GLOB" in
  "packages/*")
    echo '{"packages":[{"name":"core","path":"packages/core"},{"name":"legacy","path":"packages/legacy"}]}'
    ;;
esac
`,
    testBody: async (testRepoRoot) => {
      // Given a config with both a positive glob and a negation
      const config = configWithSinglePlugin({
        pluginUseString: "./plugin",
        matchGlob: ["packages/*", "!packages/legacy"],
      });

      // When discoverPackages runs
      const discoveredPackages = await discoverPackages({
        config,
        repoRootPath: testRepoRoot,
      });

      // Then the negated path is filtered out client-side
      assertEquals(
        discoveredPackages.map((p) => p.name),
        ["core"],
      );
    },
  });
});

Deno.test("discoverPackages invokes the discover op once per positive glob", async () => {
  await withBashPlugin({
    pluginShellScript: `
case "$DV_DISCOVER_GLOB" in
  "apps/*")     echo '{"packages":[{"name":"cli","path":"apps/cli"}]}' ;;
  "packages/*") echo '{"packages":[{"name":"core","path":"packages/core"}]}' ;;
  *)            echo '{"packages":[]}' ;;
esac
`,
    testBody: async (testRepoRoot) => {
      // Given a match list with two positive globs
      const config = configWithSinglePlugin({
        pluginUseString: "./plugin",
        matchGlob: ["apps/*", "packages/*"],
      });

      // When discoverPackages runs
      const discoveredPackages = await discoverPackages({
        config,
        repoRootPath: testRepoRoot,
      });

      // Then every glob got invoked and the union is returned, sorted by path
      assertEquals(
        discoveredPackages.map((p) => p.path),
        ["apps/cli", "packages/core"],
      );
    },
  });
});

Deno.test("discoverPackages rejects a package path claimed by two plugins", async () => {
  // Given a temp repo with two plugins that both claim the same path
  const testRepoRoot = await Deno.makeTempDir({ prefix: "dv-disco-" });
  try {
    for (const pluginFilename of ["plugin-a", "plugin-b"]) {
      const pluginExecutablePath = join(testRepoRoot, pluginFilename);
      await Deno.writeTextFile(
        pluginExecutablePath,
        `${BASH_PLUGIN_PREAMBLE}echo '{"packages":[{"name":"core","path":"packages/core"}]}'\n`,
      );
      await Deno.chmod(pluginExecutablePath, 0o755);
    }
    const config = defaults();
    config.discovery.plugins = [
      { match: "packages/*", use: "./plugin-a" },
      { match: "packages/*", use: "./plugin-b" },
    ];

    // When discoverPackages runs
    // Then it rejects with a ConfigError naming the conflict
    await assertRejects(
      () => discoverPackages({ config, repoRootPath: testRepoRoot }),
      ConfigError,
      "claimed by both",
    );
  } finally {
    await Deno.remove(testRepoRoot, { recursive: true });
  }
});

Deno.test("discoverPackages fails fast when the plugin executable does not exist", async () => {
  // Given a config referencing a path that doesn't exist
  const testRepoRoot = await Deno.makeTempDir({ prefix: "dv-disco-" });
  try {
    const config = configWithSinglePlugin({
      pluginUseString: "./does-not-exist",
      matchGlob: "packages/*",
    });

    // When discoverPackages runs
    // Then it rejects with a ConfigError before invoking anything
    await assertRejects(
      () => discoverPackages({ config, repoRootPath: testRepoRoot }),
      ConfigError,
      "plugin not found",
    );
  } finally {
    await Deno.remove(testRepoRoot, { recursive: true });
  }
});

Deno.test("discoverPackages returns an empty array when no plugins are configured", async () => {
  // Given a config with no discovery plugins
  const config = defaults();

  // When discoverPackages runs
  const discoveredPackages = await discoverPackages({
    config,
    repoRootPath: "/tmp",
  });

  // Then no packages are returned
  assertEquals(discoveredPackages, []);
});
