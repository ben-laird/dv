// The config's schema pointers: the `# yaml-language-server: $schema=`
// modeline and the top-level `$schema` key. Both are read from the raw
// text (the modeline is a comment, so the parsed YAML never sees it).
// Shared by `dv migrate config` (which rewrites them) and `dv validate`
// (which warns about them).

/** Which of the two schema pointers a finding is about. */
export type SchemaPointerKind = "modeline" | "key";

/** Matches a modeline: prefix, URL, trailing whitespace. */
export const SCHEMA_MODELINE_PATTERN: RegExp =
  /^(\s*#\s*yaml-language-server:\s*\$schema=)(\S+)(\s*)$/;

/** Matches a top-level `$schema` key: prefix, quote, URL, trailing text. */
export const SCHEMA_KEY_PATTERN: RegExp =
  /^(\$schema:[ \t]*)(["']?)([^"'\s#]+)\2(.*)$/;

const DV_CONFIG_SCHEMA_URL_PATTERN =
  /^https:\/\/jsr\.io\/@dv-cli\/dv\/([^/\s]+)\/schemas\/config\.json$/;

/** The schema pointers found in a config's text; a pointer is absent when undefined. */
export interface SchemaPointers {
  /** URL from the `# yaml-language-server: $schema=` modeline. */
  modeline?: string;
  /** URL from the top-level `$schema` key. */
  key?: string;
}

/** Reads the first modeline and the first top-level `$schema` key from config text. */
export function readSchemaPointers(configText: string): SchemaPointers {
  const pointers: SchemaPointers = {};
  for (const line of configText.split("\n")) {
    const modelineUrl = SCHEMA_MODELINE_PATTERN.exec(line)?.[2];
    if (modelineUrl !== undefined && pointers.modeline === undefined) {
      pointers.modeline = modelineUrl;
    }
    const keyUrl = SCHEMA_KEY_PATTERN.exec(line)?.[3];
    if (keyUrl !== undefined && pointers.key === undefined) {
      pointers.key = keyUrl;
    }
  }
  return pointers;
}

/**
 * The dv version a URL names, when it is dv's published config schema
 * (`https://jsr.io/@dv-cli/dv/<version>/schemas/config.json`); otherwise
 * `undefined`.
 */
export function dvConfigSchemaVersion(url: string): string | undefined {
  return DV_CONFIG_SCHEMA_URL_PATTERN.exec(url)?.[1];
}
