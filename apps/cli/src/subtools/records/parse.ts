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

export class RecordError extends DvError {
  constructor(
    code: string,
    message: string,
    public readonly recordPath: string,
  ) {
    super(code, message);
    this.name = "RecordError";
  }
}

interface ParseRecordArgs {
  fileContents: string;
  recordPath: string;
}

export function parseRecord(args: ParseRecordArgs): DvRecord {
  const { fileContents, recordPath } = args;
  if (!hasFrontmatter(fileContents)) {
    throw new RecordError(
      "frontmatter-missing",
      "Record is missing the leading YAML frontmatter block (--- ... ---)",
      recordPath,
    );
  }

  const { attrs, body } = extract(fileContents);
  const frontmatter = validateFrontmatter({ rawAttrs: attrs, recordPath });
  const bodyText = body.trim();
  if (bodyText.length === 0) {
    throw new RecordError(
      "body-empty",
      "Record body is empty — write what should appear in the CHANGELOG",
      recordPath,
    );
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
    return new RecordError(
      "frontmatter-shape",
      "Record frontmatter is invalid",
      args.recordPath,
    );
  }
  const issuePath =
    firstIssue.path.length > 0 ? firstIssue.path.join(".") : "<root>";
  return new RecordError(
    "frontmatter-shape",
    `${issuePath}: ${firstIssue.message}`,
    args.recordPath,
  );
}
