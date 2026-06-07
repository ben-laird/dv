# Schemas

`dv` commits to a handful of machine-checkable contracts. These are the
**v1 drafts** — skeletal but real; they get tightened and finalized as
the implementation lands, but the *shape* and the versioning discipline
are fixed here.

Data-file and shared contracts:

| File                    | Contract                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `config.json`           | `.dv/config.yaml` structure. See [config-format.md](../config-format.md).               |
| `record.json`           | A Record's frontmatter. See [record-format.md](../record-format.md).                           |
| `rename-ledger.json`    | `.dv/renames.yaml` lineage ledger.                                                             |
| `plugin-responses.json` | Per-Op response payloads. See [plugin-contract.md](../plugin-contract.md).                     |
| `plan.json`             | The Plan emitted by `dv status` and `--dry-run`. See [language.md](../language.md) Algebra §7. |
| `cli-error.json`        | The error envelope emitted under `--json` mode on a non-zero exit.                             |

Command `--json` result envelopes (the frozen output contract — every
`dv … --json` payload validates against one of these and carries its `$id`
in its `schema` field):

| File                          | Command                  |
| ----------------------------- | ------------------------ |
| `validation-report.json`      | `dv validate --json`     |
| `release-result.json`         | `dv release --json`      |
| `rename-result.json`          | `dv rename --json`       |
| `migrate-config-result.json`  | `dv migrate config --json` |
| `init-result.json`            | `dv init --json`         |
| `plugin-list-result.json`     | `dv plugin list --json`  |
| `plugin-verify-result.json`   | `dv plugin verify --json`|
| `plugin-invoke-result.json`   | `dv plugin invoke --json`|

`dv status` / `dv version --json` emit the bare `plan.json` shape; `dv v1
--json` does too. Every other command emits its envelope above.

**These files are generated, never hand-edited.** Their Zod sources live in
`apps/cli/src/` (the result envelopes in `apps/cli/src/cli/schemas/`, the
shared schemas alongside their subtools); the single registry of contract
ids is `apps/cli/src/domain/schema-urns.ts`. Regenerate with
`deno task schemas:generate`; `deno task schemas:check` is the drift gate.

## Versioning discipline

Each schema's `$id` is version-namespaced (`urn:dv:schema:v1:…`). A breaking
change to any schema increments that namespace (`v2`), and the host honors
both for a deprecation window. `dv plugin verify` checks Plugins against the
`plugin-responses` schema; `--json` consumers pin the `plan` and `config`
schema versions. This is what lets downstream tooling — and Plugin authors'
own CI — depend on the contract without tracking `dv`'s internal changes.

The `urn:` scheme is deliberate: these are identifiers, not URLs to fetch.
A concrete published location is a build-time decision.
