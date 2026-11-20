import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { publishedSchemaUrl } from "../domain/published-schema.ts";
import { SCHEMA_URNS } from "../domain/schema-urns.ts";
import { DV_VERSION } from "../dv-version.ts";
import type { SchemaVersionDirection } from "../subtools/config/schema-pointer.ts";
import { rawValidationReportSchema } from "./schemas/json-contracts.ts";
import {
  runValidate,
  schemaPointerWarning,
  validationSummary,
} from "./validate.ts";

interface SetUpRepoArgs {
  pluginDiscoverScript: string;
  recordFiles?: globalThis.Record<string, string>;
  renamesYaml?: string;
  /** Lines written above the config's `discovery:` section. */
  configPreamble?: string;
}

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoForValidate(
  args: SetUpRepoArgs,
): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-validate-" });
  const previousWorkingDirectory = Deno.cwd();
  Deno.chdir(repoRootPath);
  const gitInitResult = await new Deno.Command("git", {
    args: ["init", "-q"],
  }).output();
  if (!gitInitResult.success) throw new Error("git init failed");

  const configDir = join(repoRootPath, ".dv");
  const recordsDir = join(configDir, "records");
  await Deno.mkdir(recordsDir, { recursive: true });
  await Deno.writeTextFile(
    join(configDir, "config.yaml"),
    `${args.configPreamble ?? ""}discovery:
  plugins:
    - match: "packages/*"
      use:
        path: ./plugin
`,
  );

  const pluginPath = join(repoRootPath, "plugin");
  await Deno.writeTextFile(
    pluginPath,
    `#!/usr/bin/env bash
set -euo pipefail
${args.pluginDiscoverScript}
`,
  );
  await Deno.chmod(pluginPath, 0o755);

  for (const [recordFilename, recordContents] of Object.entries(
    args.recordFiles ?? {},
  )) {
    await Deno.writeTextFile(join(recordsDir, recordFilename), recordContents);
  }
  if (args.renamesYaml !== undefined) {
    await Deno.writeTextFile(join(configDir, "renames.yaml"), args.renamesYaml);
  }

  return {
    repoRootPath,
    cleanup: async () => {
      Deno.chdir(previousWorkingDirectory);
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

const NOOP_VALIDATE_OPTIONS = { emitJson: true, colorEnabled: false };

Deno.test("runValidate reports ok with zero problems when records are well-formed", async () => {
  // Given a repo with one well-formed Record referencing a discovered Package
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`,
    recordFiles: {
      "happy-record.md": `---
type: feat
packages: [core]
---

A real change.
`,
    },
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then the report carries ok=true with no problems
    assertEquals(validateResult.report.ok, true);
    assertEquals(validateResult.report.problems, []);
    assertEquals(validateResult.report.warnings, []);
    assertEquals(validateResult.report.recordsChecked, 1);
    assertEquals(validateResult.exitCode, 0);
  } finally {
    await repo.cleanup();
  }
});

const HAPPY_DISCOVER_SCRIPT = `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`;

Deno.test("runValidate warns about schema pointers at an older dv release but stays ok", async () => {
  // Given a config whose two pointers name a dv release older than any
  // that can be running
  const olderUrl = publishedSchemaUrl({ version: "0.0.1", schema: "config" });
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: HAPPY_DISCOVER_SCRIPT,
    configPreamble: `# yaml-language-server: $schema=${olderUrl}\n$schema: ${olderUrl}\n`,
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then each pointer gets a version-mismatch warning pointing at
    // `dv migrate config`, and the run is still ok with exit code 0
    assertEquals(validateResult.report.ok, true);
    assertEquals(validateResult.exitCode, 0);
    assertEquals(validateResult.report.problems, []);
    assertEquals(
      validateResult.report.warnings.map((warning) => warning.code),
      ["config-schema-version-mismatch", "config-schema-version-mismatch"],
    );
    for (const warning of validateResult.report.warnings) {
      assertStringIncludes(warning.hint, "dv migrate config");
      assertEquals(warning.source, ".dv/config.yaml");
    }
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate warns when only one schema pointer is present", async () => {
  // Given a config with the running release's modeline but no $schema key
  const currentUrl = publishedSchemaUrl({
    version: DV_VERSION,
    schema: "config",
  });
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: HAPPY_DISCOVER_SCRIPT,
    configPreamble: `# yaml-language-server: $schema=${currentUrl}\n`,
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then a single incomplete-pointer warning is reported, non-fatally
    assertEquals(
      validateResult.report.warnings.map((warning) => warning.code),
      ["config-schema-pointer-incomplete"],
    );
    assertEquals(validateResult.report.ok, true);
    assertEquals(validateResult.exitCode, 0);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate with both problems and warnings fails on the problems and still lists the warnings", async () => {
  // Given a Record naming an unknown package, and a config with only a
  // $schema key
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: HAPPY_DISCOVER_SCRIPT,
    configPreamble: "$schema: ./custom-schema.json\n",
    recordFiles: {
      "stray-record.md": `---
type: fix
packages: [ghost]
---

Refers to a package that doesn't exist.
`,
    },
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then the problem makes the run fail, and the warning is still there
    assertEquals(validateResult.report.ok, false);
    assertEquals(validateResult.exitCode, 1);
    assertEquals(
      validateResult.report.problems.map((problem) => problem.code),
      ["unresolved-reference"],
    );
    assertEquals(
      validateResult.report.warnings.map((warning) => warning.code),
      ["config-schema-pointer-incomplete"],
    );
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate sees both schema pointers in a CRLF config", async () => {
  // Given CRLF pointer lines at the running release's config schema
  const currentUrl = publishedSchemaUrl({
    version: DV_VERSION,
    schema: "config",
  });
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: HAPPY_DISCOVER_SCRIPT,
    configPreamble: `# yaml-language-server: $schema=${currentUrl}\r\n$schema: ${currentUrl}\r\n`,
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then neither pointer is reported missing
    assertEquals(validateResult.report.warnings, []);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate's report with warnings conforms to the validation-report schema", async () => {
  // Given a config that triggers a warning
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: HAPPY_DISCOVER_SCRIPT,
    configPreamble: "$schema: ./custom-schema.json\n",
  });
  try {
    // When runValidate runs and its report is round-tripped through JSON
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);
    const emittedReport: unknown = JSON.parse(
      JSON.stringify(validateResult.report),
    );

    // Then the emitted shape validates against the frozen v1 contract
    assertEquals(validateResult.report.warnings.length, 1);
    assertEquals(
      rawValidationReportSchema.safeParse(emittedReport).success,
      true,
    );
  } finally {
    await repo.cleanup();
  }
});

Deno.test("validationSummary adds a warning count only when there are warnings", () => {
  // Given reports with and without warnings
  const baseReport = {
    schema: SCHEMA_URNS.validationReport,
    ok: true,
    recordsChecked: 3,
    problems: [],
    warnings: [],
  };
  const warning = { code: "w", message: "m", hint: "h" };

  // When summarized
  // Then the warning count appears only when non-zero
  assertEquals(validationSummary(baseReport), "3 records, 0 problems");
  assertEquals(
    validationSummary({ ...baseReport, warnings: [warning, warning] }),
    "3 records, 0 problems, 2 warnings",
  );
});

Deno.test("schemaPointerWarning suggests dv migrate config only for an older pointer", () => {
  // Given version-mismatch findings in each direction
  const findingFor = (direction: SchemaVersionDirection) => {
    return {
      kind: "version-mismatch" as const,
      pointer: "key" as const,
      pointedVersion: "9.9.9",
      direction,
    };
  };

  // When each is turned into a warning
  const olderHint = schemaPointerWarning({
    finding: findingFor("older"),
    source: ".dv/config.yaml",
    keyMigratable: true,
  }).hint;
  const newerHint = schemaPointerWarning({
    finding: findingFor("newer"),
    source: ".dv/config.yaml",
    keyMigratable: true,
  }).hint;

  // Then only the older one sends the user to `dv migrate config`,
  // which never moves a pointer backwards
  assertStringIncludes(olderHint, "dv migrate config");
  assertEquals(newerHint.includes("dv migrate config"), false);
  assertStringIncludes(newerHint, "upgrade dv to 9.9.9");
});

Deno.test("runValidate reads a quoted $schema key and says migrate can't rewrite it", async () => {
  // Given a modeline and a quoted-key `"$schema":` both at an older release
  const olderUrl = publishedSchemaUrl({ version: "0.0.1", schema: "config" });
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: HAPPY_DISCOVER_SCRIPT,
    configPreamble: `# yaml-language-server: $schema=${olderUrl}\n"$schema": ${olderUrl}\n`,
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then the key is seen (no "incomplete" warning), the modeline's hint
    // is `dv migrate config`, and the key's hint says to edit it by hand
    const hints = validateResult.report.warnings.map((warning) => {
      return warning.hint;
    });
    assertEquals(
      validateResult.report.warnings.map((warning) => warning.code),
      ["config-schema-version-mismatch", "config-schema-version-mismatch"],
    );
    assertStringIncludes(hints[0] ?? "", "run `dv migrate config`");
    assertStringIncludes(hints[1] ?? "", "by hand");
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate sees a $schema key written with a space before the colon", async () => {
  // Given the running release's modeline, and the key written `$schema :`
  const currentUrl = publishedSchemaUrl({
    version: DV_VERSION,
    schema: "config",
  });
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: HAPPY_DISCOVER_SCRIPT,
    configPreamble: `# yaml-language-server: $schema=${currentUrl}\n$schema : ${currentUrl}\n`,
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then both pointers are present and current
    assertEquals(validateResult.report.warnings, []);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate flags an unresolved-reference for an unknown package", async () => {
  // Given a Record referencing a Package the plugin doesn't discover
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`,
    recordFiles: {
      "bad-record.md": `---
type: feat
packages: [ghost]
---

Refers to a package that isn't here.
`,
    },
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then the report flags the reference with the unresolved-reference code
    assertEquals(validateResult.report.ok, false);
    assertEquals(validateResult.exitCode, 1);
    assertEquals(validateResult.report.problems.length, 1);
    assertEquals(
      validateResult.report.problems[0]?.code,
      "unresolved-reference",
    );
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate accepts a reference that resolves through the rename ledger", async () => {
  // Given a Record using an old package name that the rename ledger maps
  // to a currently-discovered Package
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: `echo '{"packages":[{"name":"engine","path":"packages/engine"}]}'`,
    recordFiles: {
      "old-name-record.md": `---
type: fix
packages: [core]
---

Uses the old name.
`,
    },
    renamesYaml: `- from: core
  to: engine
  at: 1.0.0
`,
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then no problem is reported (rename closure resolved the reference)
    assertEquals(validateResult.report.ok, true);
    assertEquals(validateResult.report.problems, []);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("runValidate aggregates problems instead of bailing on the first", async () => {
  // Given two records that are bad in different ways
  const repo = await setUpRepoForValidate({
    pluginDiscoverScript: `echo '{"packages":[{"name":"core","path":"packages/core"}]}'`,
    recordFiles: {
      "shape-bad.md": `---
type: chore
packages: [core]
---

bad type
`,
      "ref-bad.md": `---
type: feat
packages: [ghost]
---

bad reference
`,
    },
  });
  try {
    // When runValidate runs
    const validateResult = await runValidate(NOOP_VALIDATE_OPTIONS);

    // Then both problems land in the report
    assertEquals(validateResult.report.ok, false);
    assertEquals(validateResult.report.problems.length, 2);
  } finally {
    await repo.cleanup();
  }
});
