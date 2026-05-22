import { assertEquals } from "@std/assert";
import type { Package } from "../../domain/package.ts";
import { formatTag } from "./format.ts";

function buildPackage(name: string, path: string): Package {
  return { name, path, plugin: "./plugin" };
}

Deno.test("formatTag substitutes {package} and {version} with the default template", () => {
  // Given the default template from config-format.md
  // When the tag is rendered
  const tag = formatTag({
    package: buildPackage("core", "packages/core"),
    version: "1.4.2",
    template: "{package}@{version}",
  });

  // Then both substitutions happen
  assertEquals(tag, "core@1.4.2");
});

Deno.test("formatTag handles custom prefixes like `v{version}` (single-package convention)", () => {
  // Given a single-package repo using bare-version tags
  // When the tag is rendered
  const tag = formatTag({
    package: buildPackage("core", "packages/core"),
    version: "2.0.0",
    template: "v{version}",
  });

  // Then only the {version} placeholder fires; the literal `v`
  // survives untouched
  assertEquals(tag, "v2.0.0");
});

Deno.test("formatTag substitutes {package-path} for users whose tag scheme mirrors directory structure", () => {
  // Given a template referencing the package's path
  // When the tag is rendered
  const tag = formatTag({
    package: buildPackage("@seshat/cli", "packages/cli"),
    version: "0.1.0",
    template: "{package-path}-{version}",
  });

  // Then the directory path lands in the tag, useful for monorepo
  // tag schemes that name by path rather than registry name
  assertEquals(tag, "packages/cli-0.1.0");
});

Deno.test("formatTag handles scoped npm-style names that contain '@'", () => {
  // Given a scoped package name (the `@seshat/dv` shape) and the
  // default template — both inputs carry literal `@` characters
  // that the substitution should NOT touch
  // When the tag is rendered
  const tag = formatTag({
    package: buildPackage("@seshat/dv", "apps/cli"),
    version: "0.3.0",
    template: "{package}@{version}",
  });

  // Then the literal `@` in the package name survives alongside the
  // `@` introduced by the template — no double-interpretation
  assertEquals(tag, "@seshat/dv@0.3.0");
});
