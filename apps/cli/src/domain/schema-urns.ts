// The single source of truth for every `--json` contract identifier dv
// emits. Each value is a URN (urn:dv:schema:<major>:<name>) stamped into
// the matching `--json` payload's `schema` field and used as the `$id` of
// the committed JSON Schema under specs/schemas/.
//
// Freezing the contract (issue #19) means: every machine-readable output
// carries one of these, the id is versioned, and a bump to the shape that
// breaks consumers bumps the version segment. `assertVersionedSchemaUrns`
// (below) is the gate that keeps the version segment present.

/** The current contract major version, the `vN` segment of every URN. */
export const SCHEMA_URN_MAJOR = "v1" as const;

/** The full URN for a contract `name`, e.g. `urn:dv:schema:v1:plan`. */
export type SchemaUrnOf<Name extends string> =
  `urn:dv:schema:${typeof SCHEMA_URN_MAJOR}:${Name}`;

// Builds a URN preserving the literal `name` in the return type, so each
// SCHEMA_URNS member keeps a precise literal type. Consumers use the value
// for `z.literal(SCHEMA_URNS.plan)` and the `SchemaUrns` interface for
// public type positions, e.g. `schema: SchemaUrns["plan"]` (referencing
// the value's type in a public type trips `deno doc --lint`).
const urn = <Name extends string>(name: Name): SchemaUrnOf<Name> =>
  `urn:dv:schema:${SCHEMA_URN_MAJOR}:${name}`;

/**
 * The registry of every `--json` contract id dv emits, keyed by a stable
 * short name. Explicitly typed (not just inferred) so it stays out of JSR's
 * slow-types gate while keeping each value's literal URN type.
 */
export interface SchemaUrns {
  // Data-file / shared schemas (generated from their own Zod sources).
  /** Id of the `.dv/config.yaml` schema. */
  readonly config: SchemaUrnOf<"config">;
  /** Id of the Record-frontmatter schema. */
  readonly record: SchemaUrnOf<"record">;
  /** Id of the `.dv/renames.yaml` ledger schema. */
  readonly renameLedger: SchemaUrnOf<"rename-ledger">;
  /** Id of the Plan emitted by `dv status` / `version` / `release`. */
  readonly plan: SchemaUrnOf<"plan">;
  /** Id of the `--json` error envelope. */
  readonly cliError: SchemaUrnOf<"cli-error">;
  // Command `--json` result envelopes.
  /** Id of the `dv validate --json` report. */
  readonly validationReport: SchemaUrnOf<"validation-report">;
  /** Id of the `dv release --json` envelope. */
  readonly releaseResult: SchemaUrnOf<"release-result">;
  /** Id of the `dv rename --json` envelope. */
  readonly renameResult: SchemaUrnOf<"rename-result">;
  /** Id of the `dv migrate config --json` envelope. */
  readonly migrateConfigResult: SchemaUrnOf<"migrate-config-result">;
  /** Id of the `dv init --json` envelope. */
  readonly initResult: SchemaUrnOf<"init-result">;
  /** Id of the `dv plugin list --json` envelope. */
  readonly pluginListResult: SchemaUrnOf<"plugin-list-result">;
  /** Id of the `dv plugin verify --json` envelope. */
  readonly pluginVerifyResult: SchemaUrnOf<"plugin-verify-result">;
  /** Id of the `dv plugin invoke --json` envelope. */
  readonly pluginInvokeResult: SchemaUrnOf<"plugin-invoke-result">;
}

/** Every `--json` contract id dv emits, keyed by a stable short name. */
export const SCHEMA_URNS: SchemaUrns = {
  config: urn("config"),
  record: urn("record"),
  renameLedger: urn("rename-ledger"),
  plan: urn("plan"),
  cliError: urn("cli-error"),
  validationReport: urn("validation-report"),
  releaseResult: urn("release-result"),
  renameResult: urn("rename-result"),
  migrateConfigResult: urn("migrate-config-result"),
  initResult: urn("init-result"),
  pluginListResult: urn("plugin-list-result"),
  pluginVerifyResult: urn("plugin-verify-result"),
  pluginInvokeResult: urn("plugin-invoke-result"),
};

/** A value of {@link SCHEMA_URNS} — every emitted contract id. */
export type SchemaUrn = SchemaUrns[keyof SchemaUrns];

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
