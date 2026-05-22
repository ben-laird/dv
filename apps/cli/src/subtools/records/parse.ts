import { test as hasFrontmatter } from "@std/front-matter";
import { extract } from "@std/front-matter/yaml";
import { basename } from "@std/path";
import type { z } from "zod";
import { DvError } from "../../domain/errors.ts";
import type { Record as DvRecord } from "../../domain/record.ts";
import {
  type ParsedRecordFrontmatter,
  parsedRecordFrontmatterSchema,
} from "./schema.ts";

// Parses one Record file (markdown + YAML frontmatter) into a typed
// Record. Errors carry a stable `code` so `dv validate --json` can
// distinguish "frontmatter-missing" from "frontmatter-shape" from
// "body-empty" — each maps to a recognizable fix.
//
// RecordError keeps a class identity so validate.ts can route record-
// parse failures to the per-record `source` field via `instanceof`.
// The path it carries moves into `kind.context.recordPath` to match
// the structured error model; a getter exposes it for back-compat
// with the few existing read sites.

export class RecordError extends DvError {
  get recordPath(): string {
    // The frontmatter-missing / frontmatter-shape / body-empty arms
    // of DvErrorShape all declare a `context.recordPath: string`.
    // The cast walks past the `unknown` arm (no context) — the
    // constructor only accepts those three codes at use-sites in
    // this file, so the narrowing is safe in practice.
    return (this.kind as unknown as { context: { recordPath: string } }).context
      .recordPath;
  }
}

interface ParseRecordArgs {
  fileContents: string;
  recordPath: string;
}

export function parseRecord(args: ParseRecordArgs): DvRecord {
  const { fileContents, recordPath } = args;
  if (!hasFrontmatter(fileContents)) {
    throw new RecordError({
      code: "frontmatter-missing",
      message:
        "Record is missing the leading YAML frontmatter block (--- ... ---)",
      context: { recordPath },
    });
  }

  const { attrs, body } = extract(fileContents);
  const frontmatter = validateFrontmatter({ rawAttrs: attrs, recordPath });
  const bodyText = body.trim();
  if (bodyText.length === 0) {
    throw new RecordError({
      code: "body-empty",
      message:
        "Record body is empty — write what should appear in the CHANGELOG",
      hint: "add a `# Headline` line and a paragraph or two of prose",
      context: { recordPath },
    });
  }

  return {
    filename: basename(recordPath),
    type: frontmatter.type,
    packages: frontmatter.packages,
    links: frontmatter.links,
    notes: frontmatter.notes,
    body: bodyText,
  };
}

interface ValidateFrontmatterArgs {
  rawAttrs: unknown;
  recordPath: string;
}

function validateFrontmatter(
  args: ValidateFrontmatterArgs,
): ParsedRecordFrontmatter {
  const validationResult = parsedRecordFrontmatterSchema.safeParse(
    args.rawAttrs,
  );
  if (!validationResult.success) {
    throw recordErrorFromZod({
      issues: validationResult.error.issues,
      recordPath: args.recordPath,
    });
  }
  return validationResult.data;
}

interface RecordErrorFromZodArgs {
  issues: z.core.$ZodIssue[];
  recordPath: string;
}

function recordErrorFromZod(args: RecordErrorFromZodArgs): RecordError {
  const firstIssue = args.issues[0];
  if (!firstIssue) {
    return new RecordError({
      code: "frontmatter-shape",
      message: "Record frontmatter is invalid",
      context: { recordPath: args.recordPath },
    });
  }
  const issuePath =
    firstIssue.path.length > 0 ? firstIssue.path.join(".") : "<root>";
  return new RecordError({
    code: "frontmatter-shape",
    message: `${issuePath}: ${firstIssue.message}`,
    context: { recordPath: args.recordPath },
  });
}
