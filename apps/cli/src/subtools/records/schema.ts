import { z } from "zod";
import { CHANGE_TYPES } from "../../domain/change-type.ts";

// Zod schemas for the Record frontmatter (specs/record-format.md
// § Frontmatter). Like the config schemas, these split into a pure shape
// (for JSON Schema generation) and a parser-shape piped through a
// transform that fills defaults.
//
// `type` is the four-flavor ChangeType union; `packages` is a non-empty
// list of Package names; `links` and `notes` are optional and never bump
// versions (notes are reviewer-only, never rendered to CHANGELOG).

export const rawRecordFrontmatterSchema = z
  .object({
    type: z
      .enum(CHANGE_TYPES)
      .describe(
        "The Conventional Commits flavor: feat, fix, feat!, fix!. Determines the Bump.",
      ),
    packages: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "Package names this Record affects. Resolved through .changelog/renames.yaml.",
      ),
    links: z
      .array(z.string())
      .optional()
      .describe("Issue / PR URLs. Rendered in the CHANGELOG entry if present."),
    notes: z
      .string()
      .optional()
      .describe("Reviewer-only notes. Never rendered to CHANGELOG."),
  })
  .strict()
  .meta({
    id: "urn:dv:schema:v1:record",
    title: "dv Record (.changelog/records/*.md frontmatter)",
    description:
      "YAML frontmatter for one pending Record (specs/record-format.md).",
  });

export type RawRecordFrontmatter = z.infer<typeof rawRecordFrontmatterSchema>;

// Parser-shape: defaults `links` to [] so downstream code can read it
// without an undefined check.
export const parsedRecordFrontmatterSchema =
  rawRecordFrontmatterSchema.transform((raw) => ({
    type: raw.type,
    packages: raw.packages,
    links: raw.links ?? [],
    notes: raw.notes,
  }));

export type ParsedRecordFrontmatter = z.infer<
  typeof parsedRecordFrontmatterSchema
>;
