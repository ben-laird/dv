import { stringify as stringifyYaml } from "@std/yaml";
import type { ChangeType } from "../../domain/change-type.ts";

// Serializes a fresh Record to the on-disk markdown + YAML frontmatter
// shape from specs/record-format.md. Used by `dv add`. Existing Records
// are never rewritten — they're a faithful account of what was authored,
// so this only emits new files.
//
// Frontmatter keys are emitted in the documented order (`type`, `packages`,
// then optional `links`, `notes`) for diff-friendliness.

export interface SerializeRecordArgs {
  type: ChangeType;
  packages: string[];
  body: string;
  links?: string[];
  notes?: string;
}

export function serializeRecord(args: SerializeRecordArgs): string {
  const frontmatterObject: globalThis.Record<string, unknown> = {
    type: args.type,
    packages: args.packages,
  };
  if (args.links !== undefined && args.links.length > 0) {
    frontmatterObject.links = args.links;
  }
  if (args.notes !== undefined && args.notes.trim().length > 0) {
    frontmatterObject.notes = args.notes.trim();
  }

  const renderedFrontmatter = stringifyYaml(frontmatterObject, {
    lineWidth: 100,
  }).trimEnd();
  const renderedBody = args.body.replace(/\s+$/g, "");
  return `---\n${renderedFrontmatter}\n---\n\n${renderedBody}\n`;
}
