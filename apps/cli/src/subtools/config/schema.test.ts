import { assertEquals } from "@std/assert";
import { z } from "zod";
import { parsedConfigLayerSchema, rawConfigLayerSchema } from "./schema.ts";

Deno.test("rawConfigLayerSchema preserves YAML's kebab-case shape verbatim", () => {
  // Given a kebab-cased layer matching the documented config-format.md shape
  const kebabCasedYamlLayer = {
    discovery: {
      plugins: [{ match: "packages/*", use: "./plugin" }],
      "use-gitignore": true,
    },
    git: { "require-clean-tree": false, "auto-commit": true },
  };

  // When the raw schema parses it
  const parsedShape = rawConfigLayerSchema.parse(kebabCasedYamlLayer);

  // Then keys stay kebab-cased — the raw schema is shape-only, no transform
  assertEquals(parsedShape.discovery?.["use-gitignore"], true);
  assertEquals(parsedShape.git?.["require-clean-tree"], false);
  assertEquals(parsedShape.git?.["auto-commit"], true);
});

Deno.test("parsedConfigLayerSchema pipes the raw shape through a kebab→camel transform", () => {
  // Given the same kebab-cased layer
  const kebabCasedYamlLayer = {
    discovery: {
      plugins: [{ match: "packages/*", use: "./plugin" }],
      "use-gitignore": true,
    },
    git: { "require-clean-tree": false, "auto-commit": true },
    safety: { "dry-run-by-default": true },
  };

  // When the parser-shaped schema parses it
  const parsedAndTransformed =
    parsedConfigLayerSchema.parse(kebabCasedYamlLayer);

  // Then keys are camelCased — the transform is the kebab→camel boundary
  assertEquals(parsedAndTransformed.discovery?.useGitignore, true);
  assertEquals(parsedAndTransformed.git?.requireCleanTree, false);
  assertEquals(parsedAndTransformed.git?.autoCommit, true);
  assertEquals(parsedAndTransformed.safety?.dryRunByDefault, true);
});

Deno.test("rawConfigLayerSchema can be rendered as a Draft 2020-12 JSON Schema", () => {
  // Given the pure shape schema (no transforms — transforms can't be rendered)

  // When z.toJSONSchema renders it
  const generatedJsonSchema = z.toJSONSchema(rawConfigLayerSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;

  // Then the rendered schema carries the expected top-level metadata,
  // including `additionalProperties: false` (from .strict()) so editors
  // flag typo'd keys.
  assertEquals(
    generatedJsonSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assertEquals(generatedJsonSchema.type, "object");
  assertEquals(generatedJsonSchema.additionalProperties, false);
  assertEquals(generatedJsonSchema.title, "dv config (.changelog/config.yaml)");
});
