import { z } from "zod";

// Zod schemas for `.changelog/config.yaml` — the in-code source of truth
// for shape, matching specs/schemas/config.json. Per
// [[feedback-zod-for-contracts]] every contract surface validates through
// Zod; if the JSON Schema and these schemas disagree, update both in the
// same change (the docs-and-code-in-lockstep rule from .claude/CLAUDE.md).
//
// Each section is .strict() so unknown keys are typo errors, and each is
// independently .partial()-shaped at the top level so a layer in the
// extends chain can override any subset.

const durationStringSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h)$/, "must look like '60s', '5m', '500ms', '1h'");

const matchGlobSchema = z.union([z.string(), z.array(z.string())]);

const pluginAssignmentSchema = z
  .object({
    match: matchGlobSchema,
    use: z.string(),
    timeout: durationStringSchema.optional(),
  })
  .strict();

const discoverySectionSchema = z
  .object({
    plugins: z.array(pluginAssignmentSchema).optional(),
    "use-gitignore": z.boolean().optional(),
  })
  .strict()
  .transform((value) => ({
    plugins: value.plugins,
    useGitignore: value["use-gitignore"],
  }));

const changesetsSectionSchema = z
  .object({
    "auto-stage": z.boolean().optional(),
  })
  .strict()
  .transform((value) => ({
    autoStage: value["auto-stage"],
  }));

const changelogSectionSchema = z
  .object({
    format: z.string().optional(),
    location: z.string().optional(),
  })
  .strict();

const taggingSectionSchema = z
  .object({
    format: z.string().optional(),
  })
  .strict();

const publishingSectionSchema = z
  .object({
    plugin: z.string().optional(),
    timeout: z.union([durationStringSchema, z.literal("none")]).optional(),
  })
  .strict();

const gitSignSchema = z.union([
  z.literal("auto"),
  z.literal(true),
  z.literal(false),
]);

const gitSectionSchema = z
  .object({
    "require-clean-tree": z.boolean().optional(),
    sign: gitSignSchema.optional(),
    "auto-commit": z.boolean().optional(),
    "commit-message-template": z.string().optional(),
    "auto-push": z.boolean().optional(),
    "push-sequence": z
      .union([z.literal("publish-then-push"), z.literal("push-then-publish")])
      .optional(),
  })
  .strict()
  .transform((value) => ({
    requireCleanTree: value["require-clean-tree"],
    sign: value.sign,
    autoCommit: value["auto-commit"],
    commitMessageTemplate: value["commit-message-template"],
    autoPush: value["auto-push"],
    pushSequence: value["push-sequence"],
  }));

const safetySectionSchema = z
  .object({
    "dry-run-by-default": z.boolean().optional(),
  })
  .strict()
  .transform((value) => ({
    dryRunByDefault: value["dry-run-by-default"],
  }));

const overrideEntrySchema = z
  .object({
    match: matchGlobSchema,
    changelog: changelogSectionSchema.optional(),
    tagging: taggingSectionSchema.optional(),
    publishing: publishingSectionSchema.optional(),
    "plugin-use": z.string().optional(),
  })
  .strict()
  .transform((value) => ({
    match: value.match,
    changelog: value.changelog,
    tagging: value.tagging,
    publishing: value.publishing,
    pluginUse: value["plugin-use"],
  }));

export const rawConfigLayerSchema = z
  .object({
    $schema: z.string().optional(),
    extends: z.union([z.string(), z.array(z.string())]).optional(),
    discovery: discoverySectionSchema.optional(),
    changesets: changesetsSectionSchema.optional(),
    changelog: changelogSectionSchema.optional(),
    tagging: taggingSectionSchema.optional(),
    publishing: publishingSectionSchema.optional(),
    git: gitSectionSchema.optional(),
    safety: safetySectionSchema.optional(),
    overrides: z.array(overrideEntrySchema).optional(),
  })
  .strict();

export type RawConfigLayer = z.infer<typeof rawConfigLayerSchema>;
