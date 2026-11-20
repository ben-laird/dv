// Where dv's JSON Schemas can be fetched. Each release of @dv-cli/dv
// publishes apps/cli/schemas/ to JSR, which serves every file at an
// immutable, versioned URL. The `$id` of each schema stays a URN
// (schema-urns.ts); this module answers the separate question of location.

/** The JSR package that publishes dv's JSON Schemas. */
export const SCHEMA_PUBLISHING_PACKAGE = "@dv-cli/dv";

/**
 * Every JSON Schema file published under `apps/cli/schemas/`, by name
 * (the file name without `.json`).
 */
export const PUBLISHED_SCHEMA_NAMES = [
  "config",
  "record",
  "rename-ledger",
  "plan",
  "plugin-responses",
  "cli-error",
  "validation-report",
  "release-result",
  "rename-result",
  "migrate-config-result",
  "init-result",
  "plugin-list-result",
  "plugin-verify-result",
  "plugin-invoke-result",
] as const;

/** The name of one published JSON Schema, e.g. `config`. */
export type PublishedSchemaName = (typeof PUBLISHED_SCHEMA_NAMES)[number];

/** Arguments to {@link publishedSchemaUrl}. */
export interface PublishedSchemaUrlArgs {
  /** The dv release whose schema to point at, e.g. `0.11.0`. */
  version: string;
  /** Which published schema. */
  schema: PublishedSchemaName;
}

/**
 * The immutable JSR URL of one published JSON Schema for one dv release:
 * `https://jsr.io/@dv-cli/dv/<version>/schemas/<schema>.json`.
 */
export function publishedSchemaUrl(args: PublishedSchemaUrlArgs): string {
  return `https://jsr.io/${SCHEMA_PUBLISHING_PACKAGE}/${args.version}/schemas/${args.schema}.json`;
}
