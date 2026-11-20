# Schemas

`dv` commits to a handful of machine-checkable contracts, expressed as
JSON Schema (draft 2020-12). The schema files live in the published
package at [`apps/cli/schemas/`](../../apps/cli/schemas/), not here: the
JSR package root is `apps/cli/`, so only files under it ship with a
release. This README is the index and the versioning policy; the files
themselves have one home.

## Published URLs

From the first release after 0.11.0 onward, every release of
`@dv-cli/dv` publishes the schemas with it, and JSR serves each published
file at an immutable, versioned URL:

```text
https://jsr.io/@dv-cli/dv/<version>/schemas/<name>.json
```

0.11.0 and earlier shipped without schemas, so no URL exists for them.
Point a file at the schema of the dv version that *reads* it, so the
schema matches the parser exactly, and update the pointer when you
upgrade dv. `dv init` writes this URL for the running version into the
config it scaffolds; see
[config-format.md § `$schema`](../config-format.md#schema).

## Contracts

Data-file and shared contracts:

| File                    | Contract                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `config.json`           | `.dv/config.yaml` structure. See [config-format.md](../config-format.md).                      |
| `record.json`           | A Record's frontmatter. See [record-format.md](../record-format.md).                           |
| `rename-ledger.json`    | `.dv/renames.yaml` lineage ledger.                                                             |
| `plugin-responses.json` | Per-Op response payloads. See [plugin-contract.md](../plugin-contract.md).                     |
| `plan.json`             | The Plan emitted by `dv status` and `--dry-run`. See [language.md](../language.md) Algebra §7. |
| `cli-error.json`        | The error envelope emitted under `--json` mode on a non-zero exit.                             |

Command `--json` result envelopes (the frozen output contract — every
`dv … --json` payload validates against one of these and carries its `$id`
in its `schema` field):

| File                         | Command                    |
| ---------------------------- | -------------------------- |
| `validation-report.json`     | `dv validate --json`       |
| `release-result.json`        | `dv release --json`        |
| `rename-result.json`         | `dv rename --json`         |
| `migrate-config-result.json` | `dv migrate config --json` |
| `init-result.json`           | `dv init --json`           |
| `plugin-list-result.json`    | `dv plugin list --json`    |
| `plugin-verify-result.json`  | `dv plugin verify --json`  |
| `plugin-invoke-result.json`  | `dv plugin invoke --json`  |

`dv status` / `dv version --json` emit the bare `plan.json` shape; `dv v1
--json` does too. Every other command emits its envelope above.

**Every file except `plugin-responses.json` is generated, never
hand-edited.** Their Zod sources live in `apps/cli/src/` (the result
envelopes in `apps/cli/src/cli/schemas/`, the shared schemas alongside
their subtools); the single registry of contract ids is
`apps/cli/src/domain/schema-urns.ts`. Regenerate with
`deno task schemas:generate`; `deno task schemas:check` is the drift gate.
`plugin-responses.json` is hand-maintained alongside the Zod parsers in
`apps/cli/src/subtools/plugin/response.ts`.

## Versioning discipline

Each schema's `$id` is version-namespaced (`urn:dv:schema:v1:…`). A breaking
change to any schema increments that namespace (`v2`), and the host honors
both for a deprecation window. `dv plugin verify` checks Plugins against the
`plugin-responses` schema; `--json` consumers pin the `plan` and `config`
schema versions. This is what lets downstream tooling — and Plugin authors'
own CI — depend on the contract without tracking `dv`'s internal changes.

The `urn:` scheme is deliberate: an `$id` identifies a contract, and stays
the same across every release that carries that contract version. Where a
file can be *fetched* is a separate concern, answered by the versioned JSR
URL above.
