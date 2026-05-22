import { assertEquals, assertStringIncludes } from "@std/assert";
import { chooseShimFileName, renderLauncher } from "./install-dev-shim.ts";

// The installer itself runs on Deno (cross-platform), but the launcher
// it writes is shell-specific. These tests lock the cross-platform
// contract — the Unix and Windows code paths can be exercised on any
// host, so no real Windows machine is required to gain confidence.

Deno.test("chooseShimFileName picks `dv` on Unix and `dv.cmd` on Windows", () => {
  // Given each supported platform
  // When chooseShimFileName runs
  // Then it returns the platform-appropriate filename
  assertEquals(chooseShimFileName("unix"), "dv");
  assertEquals(chooseShimFileName("windows"), "dv.cmd");
});

Deno.test("renderLauncher emits a POSIX sh shim on Unix", () => {
  // Given a Unix install target rooted at /repo
  const args = { repoRoot: "/repo", platform: "unix" as const };

  // When the launcher is rendered
  const launcherContents = renderLauncher(args);

  // Then it carries a sh shebang, exec's deno run, and forwards $@
  assertStringIncludes(launcherContents, "#!/bin/sh");
  assertStringIncludes(launcherContents, "exec deno run");
  assertStringIncludes(launcherContents, `--config "/repo/deno.json"`);
  assertStringIncludes(launcherContents, `"/repo/apps/cli/src/main.ts"`);
  assertStringIncludes(launcherContents, `"$@"`);
});

Deno.test("renderLauncher emits a .cmd batch shim on Windows", () => {
  // Given a Windows install target with a typical absolute path
  const args = {
    repoRoot: "C:\\repo",
    platform: "windows" as const,
  };

  // When the launcher is rendered
  const launcherContents = renderLauncher(args);

  // Then it uses cmd batch syntax (`@echo off`, `%*`) and points at the
  // documented Windows-style paths
  assertStringIncludes(launcherContents, "@echo off");
  assertStringIncludes(launcherContents, "deno run --allow-all");
  assertStringIncludes(launcherContents, `--config "C:\\repo\\deno.json"`);
  assertStringIncludes(launcherContents, `"C:\\repo\\apps\\cli\\src\\main.ts"`);
  assertStringIncludes(launcherContents, "%*");
  // sh-only constructs must not leak into the .cmd form
  assertEquals(launcherContents.includes("#!/"), false);
  assertEquals(launcherContents.includes(`"$@"`), false);
});
