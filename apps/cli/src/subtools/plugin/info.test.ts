import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { invokeInfo } from "./info.ts";

// specs/plugin-contract.md § Environment variables: DV_REPO_ROOT is
// "Set on every invocation", the mandatory `info` Op included.

Deno.test("invokeInfo sets DV_REPO_ROOT for the info Op", async () => {
  // Given a single-file plugin whose info response echoes DV_REPO_ROOT
  // back in its cosmetic `name` field
  const repoRootPath = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "dv-info-repo-root-" }),
  );
  const pluginPath = join(repoRootPath, "plugin");
  await Deno.writeTextFile(
    pluginPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '{"contractVersion":"1","supportedOps":["discover"],"name":"%s"}\\n' "$DV_REPO_ROOT"
`,
  );
  await Deno.chmod(pluginPath, 0o755);

  try {
    // When dv invokes the info Op
    const infoResponse = await invokeInfo({
      resolvedPlugin: { kind: "single", path: pluginPath },
      repoRootPath,
    });

    // Then the plugin saw the repo root in DV_REPO_ROOT
    assertEquals(infoResponse.name, repoRootPath);
  } finally {
    await Deno.remove(repoRootPath, { recursive: true });
  }
});
