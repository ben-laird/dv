// The single source of truth for every `--json` contract identifier dv
// emits. Each value is a URN (urn:dv:schema:<major>:<name>) stamped into
// the matching `--json` payload's `schema` field and used as the `$id` of
// the committed JSON Schema under specs/schemas/.
//
// Freezing the contract (issue #19) means: every machine-readable output
// carries one of these, the id is versioned, and a bump to the shape that
// breaks consumers bumps the version segment. `assertVersionedSchemaUrns`
// (below) is the gate that keeps the version segment present.

export const SCHEMA_URN_MAJOR = "v1" as const;

const urn = (name: string): string =>
  `urn:dv:schema:${SCHEMA_URN_MAJOR}:${name}`;

/** Every `--json` contract id dv emits, keyed by a stable short name. */
export const SCHEMA_URNS = {
  // Data-file / shared schemas (generated from their own Zod sources).
  config: urn("config"),
  record: urn("record"),
  renameLedger: urn("rename-ledger"),
  plan: urn("plan"),
  cliError: urn("cli-error"),
  // Command `--json` result envelopes.
  validationReport: urn("validation-report"),
  releaseResult: urn("release-result"),
  renameResult: urn("rename-result"),
  migrateConfigResult: urn("migrate-config-result"),
  initResult: urn("init-result"),
  pluginListResult: urn("plugin-list-result"),
  pluginVerifyResult: urn("plugin-verify-result"),
  pluginInvokeResult: urn("plugin-invoke-result"),
} as const;

/** A value of {@link SCHEMA_URNS} — every emitted contract id. */
export type SchemaUrn = (typeof SCHEMA_URNS)[keyof typeof SCHEMA_URNS];

/**
 * The freeze gate: throws if any registered URN is missing the
 * `urn:dv:schema:<major>:` prefix (i.e. is unversioned). Run by the
 * schema generator/check so an unversioned id can't slip into the
 * contract. Returns the list it validated for convenience.
 */
export function assertVersionedSchemaUrns(): string[] {
  const prefix = `urn:dv:schema:${SCHEMA_URN_MAJOR}:`;
  const all = Object.values(SCHEMA_URNS);
  for (const value of all) {
    if (!value.startsWith(prefix)) {
      throw new Error(
        `schema URN '${value}' is not versioned with '${prefix}' — the --json contract must stay frozen`,
      );
    }
  }
  return all;
}
