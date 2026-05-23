import { z } from "zod";

// Zod schema for the rename ledger (specs/record-format.md § renames.yaml,
// specs/language.md § Lexicon). The file is a YAML array of `from → to`
// edges with the new Package's first Version under its new name. The
// `at` field is documentation for the changelog renderer; resolution
// itself follows the reflexive-transitive closure of the edge graph
// (Algebra §8), implemented in ./resolve.ts.

export const renameLedgerEntrySchema = z
  .object({
    from: z
      .string()
      .min(1)
      .describe("Old Package name (referenced by Records)."),
    to: z.string().min(1).describe("New Package name (the current identity)."),
    at: z
      .string()
      .min(1)
      .describe("New Package's first Version under the new name."),
  })
  .strict()
  .meta({
    title: "Rename entry",
    description: "A single `from → to` lineage edge in the rename ledger.",
  });

export const renameLedgerSchema = z.array(renameLedgerEntrySchema).meta({
  id: "urn:dv:schema:v1:rename-ledger",
  title: "dv rename ledger (.dv/renames.yaml)",
  description:
    "Append-only ledger of Package renames. Resolution follows the reflexive-transitive closure of these edges (specs/language.md Algebra §8).",
});

export type RenameLedgerEntry = z.infer<typeof renameLedgerEntrySchema>;
