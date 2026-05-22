# Schemas

`dv` commits to a handful of machine-checkable contracts. These are the
**v1 drafts** — skeletal but real; they get tightened and finalized as
the implementation lands, but the *shape* and the versioning discipline
are fixed here.

| File                    | Contract                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `config.json`           | `.changelog/config.yaml` structure. See [config-format.md](../config-format.md).               |
| `plugin-responses.json` | Per-Op response payloads. See [plugin-contract.md](../plugin-contract.md).                     |
| `plan.json`             | The Plan emitted by `dv status` and `--dry-run`. See [language.md](../language.md) Algebra §7. |
| `cli-error.json`        | The error envelope emitted under `--json` mode on a non-zero exit.                             |

## Versioning discipline

Each schema's `$id` is version-namespaced (`urn:dv:schema:v1:…`). A breaking
change to any schema increments that namespace (`v2`), and the host honors
both for a deprecation window. `dv plugin verify` checks Plugins against the
`plugin-responses` schema; `--json` consumers pin the `plan` and `config`
schema versions. This is what lets downstream tooling — and Plugin authors'
own CI — depend on the contract without tracking `dv`'s internal changes.

The `urn:` scheme is deliberate: these are identifiers, not URLs to fetch.
A concrete published location is a build-time decision.
