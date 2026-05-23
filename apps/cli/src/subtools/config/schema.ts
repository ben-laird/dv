import { z } from "zod";

// Zod schemas for `.dv/config.yaml` — the in-code source of truth
// for shape, used by:
//   1. loadConfig (runtime YAML validation, in parse.ts)
//   2. `deno task schemas:generate` (emits specs/schemas/config.json,
//      which IDEs consume for autocomplete)
//
// **Invariant:** these schemas describe *shape only* — no `.transform()`
// calls, because `z.toJSONSchema()` cannot represent them. The kebab→camel
// mapping into the domain `Config` type happens in parse.ts's merger.
//
// Field-level `.describe()` and section-level `.meta()` calls populate
// the generated JSON Schema with hover content. Per
// [[feedback-zod-for-contracts]] every contract surface validates
// through Zod; the JSON Schema is a derived artifact, never hand-edited.
//
// Each section is `.strict()` so unknown keys are typo errors. Each is
// independently `.partial()`-shaped at the top level so a layer in the
// extends chain can override any subset.

const durationStringSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h)$/, "must look like '60s', '5m', '500ms', '1h'")
  .meta({
    title: "Duration",
    description: "A duration like '60s', '5m', '500ms', '1h'.",
    examples: ["60s", "5m", "500ms"],
  });

const matchGlobSchema = z
  .union([z.string(), z.array(z.string())])
  .describe("A glob or list of globs (gitignore-style negation with '!').");

const pluginAssignmentSchema = z
  .object({
    match: matchGlobSchema,
    use: z
      .string()
      .describe(
        "Path to a plugin executable (./..., /..., ~/...) or a builtin name.",
      ),
    timeout: durationStringSchema
      .optional()
      .describe(
        "Max wall-clock for this plugin's fast ops (discover, read-version, write-version, update-dependency). Default 60s.",
      ),
  })
  .strict()
  .meta({
    title: "Plugin assignment",
    description: "Binds a glob of paths to the plugin that manages them.",
  });

const discoverySectionSchema = z
  .object({
    plugins: z
      .array(pluginAssignmentSchema)
      .optional()
      .describe(
        "Plugin assignments. The sole source of truth for which paths are Packages.",
      ),
    "use-gitignore": z
      .boolean()
      .optional()
      .describe(
        "Honor .gitignore during discovery — ignored paths are skipped. Default true.",
      ),
  })
  .strict()
  .meta({
    title: "Discovery subtool",
    description:
      "Enumerates Packages and resolves which Plugin manages each (specs/config-format.md § discovery).",
  });

const recordsSectionSchema = z
  .object({
    "auto-stage": z
      .boolean()
      .optional()
      .describe("`git add` the Record file created by `dv add`. Default true."),
  })
  .strict()
  .meta({
    title: "Records subtool",
    description:
      "Authoring, parsing, and validation of Records (specs/cli.md § dv add).",
  });

const changelogSectionSchema = z
  .object({
    format: z
      .string()
      .optional()
      .describe(
        "CHANGELOG output format. v1 supports only 'keep-a-changelog'.",
      ),
    location: z
      .string()
      .optional()
      .describe(
        "Template for each Package's CHANGELOG path. Supports {package}, {version}, {package-path}.",
      ),
  })
  .strict()
  .meta({
    title: "Changelog subtool",
    description:
      "How rendered CHANGELOG files are written (specs/config-format.md § changelog).",
  });

const historySectionSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe(
        "Write a long-form HISTORY.md companion to CHANGELOG.md. Default false.",
      ),
    location: z
      .string()
      .optional()
      .describe(
        "Template for each Package's HISTORY path. Supports {package}, {version}, {package-path}.",
      ),
  })
  .strict()
  .meta({
    title: "History subtool",
    description:
      "How rendered HISTORY files are written (specs/config-format.md § history). HISTORY carries each Record's full body prose under h3 subsections, grouped by version. Opt-in: dv defaults to CHANGELOG-only.",
  });

const taggingSectionSchema = z
  .object({
    format: z
      .string()
      .optional()
      .describe(
        "Template for git tags. Default '{package}@{version}'. Supports {package}, {version}, {package-path}.",
      ),
  })
  .strict()
  .meta({
    title: "Tagging subtool",
    description:
      "How per-Package git Tags are formatted (specs/config-format.md § tagging).",
  });

const publishingSectionSchema = z
  .object({
    plugin: z
      .string()
      .optional()
      .describe(
        "Executable invoked per Package after tagging (the release Op).",
      ),
    timeout: z
      .union([durationStringSchema, z.literal("none")])
      .optional()
      .describe(
        "Max wall-clock for the release Op. Default 'none' — publishing is slow and variable.",
      ),
  })
  .strict()
  .meta({
    title: "Publishing subtool",
    description:
      "How release plugins are invoked after tagging (specs/config-format.md § publishing).",
  });

const gitSignSchema = z
  .union([z.literal("auto"), z.literal(true), z.literal(false)])
  .describe(
    "Commit/tag signing. 'auto' honors git's own config; true/false force or disable.",
  );

const gitSectionSchema = z
  .object({
    "require-clean-tree": z
      .boolean()
      .optional()
      .describe(
        "Refuse `dv version` / `dv release` with uncommitted changes. Default true.",
      ),
    sign: gitSignSchema.optional(),
    "auto-commit": z
      .boolean()
      .optional()
      .describe(
        "Commit the changes `dv version` produces. Default true; --no-commit overrides.",
      ),
    "commit-message-template": z
      .string()
      .optional()
      .describe(
        "Template for the auto-commit message. Supports {summary} and {details}.",
      ),
    "auto-push": z
      .boolean()
      .optional()
      .describe(
        "Push minted tags during `dv release`. Default false; --push overrides.",
      ),
    "push-sequence": z
      .union([z.literal("publish-then-push"), z.literal("push-then-publish")])
      .optional()
      .describe(
        "Order of operations when pushing is enabled. Default 'publish-then-push'.",
      ),
  })
  .strict()
  .meta({
    title: "Git substrate",
    description:
      "Shared git behavior used by every subtool (specs/config-format.md § git).",
  });

const safetySectionSchema = z
  .object({
    "dry-run-by-default": z
      .boolean()
      .optional()
      .describe(
        "Flip destructive commands to --dry-run unless --no-dry-run is passed. Default false.",
      ),
  })
  .strict()
  .meta({
    title: "Safety",
    description: "Repo-wide safety defaults (specs/config-format.md § safety).",
  });

const overrideEntrySchema = z
  .object({
    match: matchGlobSchema,
    changelog: changelogSectionSchema.optional(),
    history: historySectionSchema.optional(),
    tagging: taggingSectionSchema.optional(),
    publishing: publishingSectionSchema.optional(),
    "plugin-use": z
      .string()
      .optional()
      .describe("Override the plugin assignment for matched Packages."),
  })
  .strict()
  .meta({
    title: "Override entry",
    description:
      "First-match-wins per-Package override of a subset of settings.",
  });

export const rawConfigLayerSchema = z
  .object({
    $schema: z
      .string()
      .optional()
      .describe(
        "Pointer to the dv config schema for editor autocomplete (e.g. ./specs/schemas/config.json or a published URL).",
      ),
    extends: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Local path(s) to base configs, merged first-to-last. Top-level only; HTTPS sources are not supported in v1.",
      ),
    discovery: discoverySectionSchema.optional(),
    records: recordsSectionSchema.optional(),
    changelog: changelogSectionSchema.optional(),
    history: historySectionSchema.optional(),
    tagging: taggingSectionSchema.optional(),
    publishing: publishingSectionSchema.optional(),
    git: gitSectionSchema.optional(),
    safety: safetySectionSchema.optional(),
    overrides: z
      .array(overrideEntrySchema)
      .optional()
      .describe(
        "Per-Package overrides. First match wins; order most-specific to least-specific.",
      ),
  })
  .strict()
  .meta({
    id: "urn:dv:schema:v1:config",
    title: "dv config (.dv/config.yaml)",
    description:
      "Subtool-organized configuration for dv. Keys are kebab-case. See specs/config-format.md.",
  });

export type RawConfigLayer = z.infer<typeof rawConfigLayerSchema>;

// Parser-shaped schema: pure shape piped through a transform that maps
// kebab-case YAML keys to camelCase, so loadConfig consumes idiomatic
// TypeScript without the parse.ts merger having to know the YAML's key
// flavor. The shape schema above remains pristine for JSON Schema
// emission; this one is what actual config parsing runs through.

export const parsedConfigLayerSchema = rawConfigLayerSchema.transform(
  (rawLayer) => ({
    $schema: rawLayer.$schema,
    extends: rawLayer.extends,
    discovery: rawLayer.discovery
      ? {
          plugins: rawLayer.discovery.plugins,
          useGitignore: rawLayer.discovery["use-gitignore"],
        }
      : undefined,
    records: rawLayer.records
      ? { autoStage: rawLayer.records["auto-stage"] }
      : undefined,
    changelog: rawLayer.changelog,
    history: rawLayer.history,
    tagging: rawLayer.tagging,
    publishing: rawLayer.publishing,
    git: rawLayer.git
      ? {
          requireCleanTree: rawLayer.git["require-clean-tree"],
          sign: rawLayer.git.sign,
          autoCommit: rawLayer.git["auto-commit"],
          commitMessageTemplate: rawLayer.git["commit-message-template"],
          autoPush: rawLayer.git["auto-push"],
          pushSequence: rawLayer.git["push-sequence"],
        }
      : undefined,
    safety: rawLayer.safety
      ? { dryRunByDefault: rawLayer.safety["dry-run-by-default"] }
      : undefined,
    overrides: rawLayer.overrides?.map((entry) => ({
      match: entry.match,
      changelog: entry.changelog,
      history: entry.history,
      tagging: entry.tagging,
      publishing: entry.publishing,
      pluginUse: entry["plugin-use"],
    })),
  }),
);

export type ParsedConfigLayer = z.infer<typeof parsedConfigLayerSchema>;
