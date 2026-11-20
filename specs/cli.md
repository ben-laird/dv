# CLI reference

Every `dv` command: synopsis, behavior, flags, and examples. Terms used here
(Record, Plan, Tag, Stability, Unresolved Reference, …) are defined in
[language.md](language.md).

The commands fall into three groups:

- **Authoring** — `init`, `add`, `validate`, `status`
- **Releasing** — `version`, `release`, `v1`
- **Maintenance** — `rename`, `plugin invoke`, `plugin verify`

---

## Conventions

Behaviors shared by every command, so they aren't repeated below.

| Aspect          | Rule                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Output          | Human-readable by default. `--json` emits a stable, versioned schema where supported.                 |
| Color           | On when stdout is a TTY; suppressed by `NO_COLOR` or `--no-color`.                                     |
| Verbosity       | `-s` / `--short`, default, `-v` / `--verbose`.                                                        |
| Booleans        | Every `--foo` accepts `--no-foo` and `--foo=false`. Flags override config.                            |
| Dry run         | `--dry-run` is global; it has real effect on destructive commands (`version`, `release`, `v1`).       |
| Confirmation    | Gated commands prompt in a TTY; `--yes` confirms non-interactively (required in non-TTY).             |
| Exit codes      | `0` success; documented non-zero on failure. In `--json`, failures carry a structured `error` code.   |

Config + flag parity: any runtime behavior settable in `config.yaml` is also
a flag, and vice versa. See [config-format.md](config-format.md).

---

## `dv init`

```
dv init
```

Scaffolds a fresh repo: writes a starter `.dv/config.yaml` and
creates the `.dv/records/` directory. Idempotent — re-running against
an initialized repo is a no-op, not an error.

The starter config points at the published config schema for the
running dv version, both as a `# yaml-language-server: $schema=…`
modeline on its first line and as a `$schema` key, so editors offer
autocomplete and validation from the start. See
[config-format.md § `$schema`](config-format.md#schema).

```
$ dv init
created .dv/config.yaml
created .dv/records/
```

---

## `dv add`

```
dv add [--type <t>] [--packages <p>...] [--message <m>]
       [--links <url>...] [--notes <text>] [--stage | --no-stage]
```

Files a Record — one pending change. Interactive by default; fully
flag-driven for automation.

**Interactive flow.** A single type prompt (all four Change Types visible:
`feat`, `fix`, `feat!`, `fix!`); a multi-select package prompt with the
current directory's Package pre-selected when applicable; an inline Bump
preview showing each selected Package's current → projected Version; then
`$EDITOR` (falling back `$VISUAL` → `vi` / `notepad`) opens on a contextual
template. An empty body (after stripping comment lines) aborts with no file
written.

**Non-interactive.** `--type`, `--packages`, and `--message` are the three
required flags in a non-TTY context; `--links` and `--notes` are optional.

| Flag             | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `--type`         | Change Type: `feat`, `fix`, `feat!`, `fix!`.                            |
| `--packages`     | One or more Package names the Record affects.                           |
| `--message`      | The Record body (becomes the CHANGELOG line).                           |
| `--links`        | Optional reference URLs (issues, PRs).                                  |
| `--notes`        | Optional freeform notes appended to the body.                          |
| `--stage` / `--no-stage` | Override `records.auto-stage` for this invocation.              |

```
# interactive
$ dv add

# non-interactive (CI, scripts, agents)
$ dv add --type fix --packages core --message "Handle empty manifest gracefully"
created .dv/records/quiet-cats-sneeze.md
```

---

## `dv status`

```
dv status [-v | --verbose] [-s | --short] [--all] [--json]
```

Read-only overview of the pipeline, modeled on `git status`. Never mutates.
Two sections:

- **Pending Records** — what `dv version` would do: per-Package current →
  projected Version, the aggregated Bump, change counts, and cascade
  constraint updates.
- **Awaiting release** — Packages whose current Version has no Tag: what
  `dv release` would do, derived purely from tags-as-state.

Fail-soft: a broken Record doesn't abort the command; `status` shows what it
can and points to `dv validate`.

| Flag          | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `-v` / `--verbose` | Per-Record detail under each Package.                          |
| `-s` / `--short`   | One compact line per Package.                                  |
| `--all`       | Include Packages with no pending changes.                            |
| `--json`      | Structured output — the same Plan schema as `dv version --dry-run`.  |

```
$ dv status
Pending Records — 3 records, 2 packages (run `dv version`):
  core      1.4.2 → 1.5.0   minor   (2 feat, 1 fix)
  cli       0.8.0 → 0.8.1   patch   (1 fix)

Awaiting release — 1 package (run `dv release`):
  utils     2.1.0           no tag utils@2.1.0
```

---

## `dv validate`

```
dv validate [--json]
```

Lints the `.dv/` directory: Record frontmatter, Change Types, Package
references, and config well-formedness. Safe and side-effect-free — intended
for CI. Exits non-zero if anything is malformed.

```
$ dv validate
✓ 3 records, 0 problems
```

**Warnings.** Some findings are worth reporting but don't make anything
malformed. They are listed as warnings, which **never** affect the exit
code or the report's `ok` flag. The summary line adds a count when there
are any, and each warning prints with a `⚠` and a hint:

```
$ dv validate
✓ 3 records, 0 problems, 1 warning
  ⚠ config-schema-version-mismatch: the `$schema` key names the config schema for dv 0.12.0, but this is dv 0.14.0 .dv/config.yaml
    hint: run `dv migrate config` to point it at this dv release
```

Warning codes are an open set; consumers of `--json` must tolerate codes
they don't recognize. These are findings *about the repo* that a
successful run reports, which is why they live in the report's
`warnings` array; the `severity: "warning"` entries of the `cli-error`
envelope are a different thing, diagnostics attached to a command that
failed. The current codes check the config's schema
pointers (see [config-format.md § `$schema`](config-format.md#schema)),
and only when the config loads:

| Code                               | When                                                                                                    | Hint                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `config-schema-version-mismatch`   | The modeline or the `$schema` key names dv's published config schema for a version other than the running dv (one warning per pointer). | Older: run `dv migrate config` (or, for a key form migrate doesn't rewrite, edit it by hand). Newer: upgrade dv, or point it at the running version's URL. |
| `config-schema-pointer-incomplete` | Exactly one of the two pointers is present. A config with neither has opted out and gets no warning.   | Add the missing pointer with the same URL.                                                   |

Pointers at anything other than dv's published config schema (a local
path, a custom URL) are never version-checked. The `$schema` key is read
from the parsed YAML, so any spelling of it counts (`"$schema":`,
`$schema :`, a flow mapping); the modeline is read from the leading
comment block.

| Flag     | Meaning                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--json` | Emit the `urn:dv:schema:v1:validation-report` envelope: `ok`, `recordsChecked`, `problems`, and `warnings` (each `{code, message, source?, hint}`). |

---

## `dv version`

```
dv version [--dry-run] [--no-commit] [--prune] [--yes]
```

Phase one of the release. Consumes pending Records and, per Package: applies
the aggregated Bump, rewrites the manifest Version, prepends CHANGELOG
entries (and HISTORY entries when `history.enabled: true` in config),
updates dependents' constraints (constraint-only cascade), and deletes the
consumed Records. Auto-commits the result by default with a templated
message (CC-shaped — an emission convention only; `dv` never parses
contributor commits). **Does not push.** The commit it produces lands on
`main` under release-on-merge, or is reviewed as a Release PR when a team
gates the bump.

Halts on an Unresolved Reference (a Record pointing at a Package that no
longer exists with no Rename edge); `--prune` drops such Records instead.

| Flag          | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| `--dry-run`   | Compute and print the Plan; make zero changes.                     |
| `--no-commit` | Stage the changes instead of committing (overrides `git.auto-commit`). |
| `--prune`     | Drop Records with Unresolved References rather than halting.       |
| `--yes`       | Skip confirmation (required in non-TTY if a prompt would appear).  |

```
$ dv version --dry-run
Plan: bump core 1.4.2→1.5.0 (minor), cli 0.8.0→0.8.1 (patch)
      update 1 dependent constraint, delete 3 records, 1 commit
$ dv version
✓ versioned 2 packages, committed (chore(release): ...)
```

---

## `dv release`

```
dv release [--dry-run] [--force] [--push | --no-push] [--yes]
```

Phase two. **Stateless** — git Tags are the source of truth for what's
released. A Package is released iff its current Version already has a Tag, so
`dv release` mints Tags for every Package whose Version is untagged, then
fires the publishing plugin for each. Does not push by default.

When pushing is enabled, the default `publish-then-push` sequence publishes
before pushing Tags so a failed publish doesn't leave an unrecoverable
pushed Tag. The first `1.0.0` Tag is detected and celebrated here.

| Flag          | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| `--dry-run`   | Print the Plan (which Tags, which publishes); make zero changes. Write-side plugin Ops are logged, not invoked. |
| `--force`     | Re-run publish for already-tagged Packages (failed-publish recovery). |
| `--push` / `--no-push` | Override `git.auto-push` for this invocation.             |
| `--yes`       | Confirm non-interactively (required in non-TTY).                   |
| `--json`      | Emit the release envelope on stdout. Suppresses the human summary. |

`--json` always emits the **same wrapped envelope** —
`{ plan, mintedTagNames, reusedTagNames, releaseOpOutcomes, pushedTagNames }` —
on every path. The no-op (nothing to release) and `--dry-run` paths emit it
with empty action arrays rather than a bare Plan, so a consumer parses one
shape regardless of outcome (git's default-vs-`--porcelain` discipline:
`--json` is a contract).

```
$ dv release --dry-run
Plan: tag core@1.5.0, cli@0.8.1, utils@2.1.0; publish 3 packages
$ dv release --yes
✓ tagged 3 packages, published 3
```

---

## `dv v1`

```
dv v1 [<package>] [--dry-run] [--no-commit] [--prune]
                  [--allow-dirty | --no-allow-dirty] [--yes]
```

The 1.0 commitment. Promotes a single pre-1.0 (`Unstable`) Package to
`1.0.0`: a phase-one operation that consumes its pending Records, sets the
Version to `1.0.0`, updates dependents' constraints to `^1.0.0` (the
constraint-only cascade), and commits. Scoped strictly to the
`0.x → 1.0.0` transition — it **errors if the Package is already `≥ 1.0`**.

This command exists because no Record can ever produce a `1.0.0`: the bump
algebra caps `Unstable` Packages below `major` (see
[language.md](language.md) Algebra §3). Crossing 1.0 is therefore always a
deliberate, gated act, never an accident.

**`<package>` is required for a real run; optional under `--dry-run`.**
When `--dry-run` is set and `<package>` is omitted, `dv v1` enters
**catalog mode**: it lists every discovered Package currently in the
`Unstable` regime (`0.x.y`) along with the per-package Plan that
`dv v1 <pkg> --dry-run` would emit. Useful for answering "which of
these are ready to promote?" without invoking the command once per
candidate. A real run still requires the explicit `<package>` —
catalog mode is a discovery aid, not a bulk-promote.

`dv v1` shares its flag surface with [`dv version`](#dv-version): the same
clean-tree gating, dry-run-by-default support, Unresolved Reference
handling, and commit override all apply. The differences are that
`dv v1` targets exactly one package, pins the new version to `1.0.0`, and
prompts for confirmation (or requires `--yes`) because the promotion is a
stability commitment.

| Flag                                | Meaning                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `--dry-run`                         | Compute and print the Plan; make zero changes. Same Plan shape as `dv version --dry-run`. |
| `--no-dry-run`                      | Force a real run even when `safety.dry-run-by-default` is on.              |
| `--no-commit`                       | Stage the changes instead of committing (overrides `git.auto-commit`).     |
| `--prune`                           | Drop Records with Unresolved References rather than halting.               |
| `--allow-dirty` / `--no-allow-dirty`| Override `git.require-clean-tree` for this invocation.                     |
| `--yes`                             | Skip the confirmation gate (required in non-TTY).                          |

```
$ dv v1 core --dry-run
Plan (dry-run):
  core 0.7.4 → 1.0.0 (first stable!)
       └ would update dependents: cli

$ dv v1 core
About to commit core to 1.0.0 — this is a stability promise. Proceed? [y/N]
```

---

## `dv migrate config`

```
dv migrate config [--dry-run] [--json]
```

Rewrites `.dv/config.yaml` to match the current dv. Each breaking config
change between dv versions ships with one migration step in the
[config-migrations subtool](../apps/cli/src/subtools/config-migrations/),
and so does each piece of routine upkeep a config needs as dv moves on
(such as `schema-pointer-current` below); this command walks every
registered step against the file. Idempotent
— running on an already-migrated config is a friendly no-op.

The first step, `use-key-discriminated`,
rewrites the pre-1.0 string form of `use:` (and `publishing.plugin`,
`overrides[].plugin-use`) into the tagged reference shape documented
in [config-format.md § Plugin resolution](config-format.md#plugin-resolution).
The migrator preserves the legacy resolver's exact shape heuristic
so a migrated config behaves identically: path-shaped strings become
`path:`, everything else becomes `builtin:`.

A second step, `schema-pointer-current`, keeps the config's schema
pointers in step with the running dv. When the modeline (the first
`# yaml-language-server: $schema=` comment in the config's leading block
of comment, blank and `---` lines, before any YAML content) or the
top-level `$schema`
key names dv's published config schema for an **older** dv release
(`https://jsr.io/@dv-cli/dv/<older>/schemas/config.json`), the step
rewrites that URL to the running version's. Each pointer is checked on
its own. Any other URL — a local path, another package, a custom host,
or a newer dv release — is left untouched. The step rewrites only the block form of the key, `$schema: <url>` at
the start of a line (the URL may be quoted); a quoted key
(`"$schema": …`), `$schema :` or a flow mapping is left as written, and
`dv validate`'s hint says to change it by hand. Changes report `path` as
`# yaml-language-server` or `$schema`, `kind` as `schema-url`, `before`
as the old URL and `value` as the new one. See
[config-format.md § `$schema`](config-format.md#schema).

| Flag        | Meaning                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `--dry-run` | Report changes without writing the file. Exit 0 either way.                                     |
| `--json`    | Emit `urn:dv:schema:v1:migrate-config-result` envelope on stdout. Suppresses the human summary. |

```
$ dv migrate config

✓ migrated 1 change in /repo/.dv/config.yaml

  use-key-discriminated — Rewrite the pre-1.0 string form of `use:` ...
    discovery.plugins[0].use  ./examples/plugins/deno  →  path: ./examples/plugins/deno
```

User comments and surrounding whitespace are preserved verbatim
across the rewrite — they explain *why* the config is shaped a
certain way, and the migrator's text-based transform leaves them
untouched.

---

## `dv rename`

```
dv rename <old> <new>
```

Appends a lineage edge `old → new` to `.dv/renames.yaml` so that
existing Records and release history referencing `old` resolve to `new`.
**Bookkeeping only** — it does not move directories, edit manifests, or
rewrite Records. Equivalent to hand-editing the ledger; the command just
spares you the syntax. See [design.md](design.md) § Renames for why detection
is never automatic.

```
$ dv rename core engine
recorded rename core → engine in .dv/renames.yaml
```

---

## `dv plugin list`

```
dv plugin list [--json]
```

Read-only audit: resolves every Plugin in `.dv/config.yaml`, runs
per-assignment discovery, and shows which Packages each Plugin claims.
The whole-config sibling of [`dv plugin verify`](#dv-plugin-verify)
(per-plugin deep check) and [`dv status`](#dv-status) (per-Record
preview). Fail-soft per row — a broken Plugin produces a
`resolve-failed` or `discover-failed` row without hiding the rest, so
one bad config entry doesn't blind the audit.

No destructive ops fire. Use this before `dv version` / `dv release` to
sanity-check that discovery agrees with the package set you expect.

| Flag     | Meaning                                                                              |
| -------- | ------------------------------------------------------------------------------------ |
| `--json` | Emit `urn:dv:schema:v1:plugin-list-result` envelope on stdout. Suppresses the human summary. |

```
$ dv plugin list

Plugins (1 configured):

  ✓ run:deno run -A ./examples/plugins/deno/main.ts  2 packages  matches: apps/*, packages/*
      @dv-cli/dv               apps/cli
      @dv-cli/clipc              packages/cli
```

Exit code: `0` when every assignment resolved and discovered cleanly,
`1` when any row reports `resolve-failed` or `discover-failed`.

---

## `dv plugin invoke`

```
dv plugin invoke <plugin> <op> [--package <name>] [--path <dir>]
                 [--json '<payload>']
```

Runs a single Op against a Plugin with controlled inputs — no repo, config,
or Records required. Sets the env vars / stdin `dv` would set, prints the
full exchange, and conformance-checks the response. The workhorse for
iterating on one Op. See [plugin-contract.md](plugin-contract.md).

```
$ dv plugin invoke ./my-plugin read-version --package core --path packages/core
→ DV_PACKAGE_NAME=core  DV_PACKAGE_PATH=packages/core  DV_OPERATION=read-version
← stdout: {"version":"1.2.3"}   exit: 0
✓ valid read-version response (version=1.2.3)
```

---

## `dv plugin verify`

```
dv plugin verify <plugin>
```

Automated conformance smoke test, CI-friendly. Checks the Plugin is
resolvable and executable, that `discover` is present, that each declared Op
returns contract-valid JSON (against the versioned per-op response schemas),
and that bad input produces a non-zero exit. Run it in a Plugin's own
pipeline to guard against contract drift.

```
$ dv plugin verify ./my-plugin
✓ discover  ✓ read-version  ✓ write-version  ✓ update-dependency
4 ops verified, 0 problems
```

---

## See also

- [walkthrough.md](walkthrough.md) — these commands in sequence on a sample monorepo.
- [config-format.md](config-format.md) — the config side of every flag.
- [language.md](language.md) — the vocabulary and the algebra behind the behavior.
