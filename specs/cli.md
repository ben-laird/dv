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

Scaffolds a fresh repo: writes a starter `.changelog/config.yaml` and
creates the `.changelog/records/` directory. Idempotent — re-running against
an initialized repo is a no-op, not an error.

```
$ dv init
created .changelog/config.yaml
created .changelog/records/
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
created .changelog/records/quiet-cats-sneeze.md
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

Lints the `.changelog/` directory: Record frontmatter, Change Types, Package
references, and config well-formedness. Safe and side-effect-free — intended
for CI. Exits non-zero if anything is malformed.

```
$ dv validate
✓ 3 records, 0 problems
```

---

## `dv version`

```
dv version [--dry-run] [--no-commit] [--prune] [--yes]
```

Phase one of the release. Consumes pending Records and, per Package: applies
the aggregated Bump, rewrites the manifest Version, prepends CHANGELOG
entries, updates dependents' constraints (constraint-only cascade), and
deletes the consumed Records. Auto-commits the result by default with a
templated Conventional-Commits message. **Does not push.** The commit it
produces is the Release PR.

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

```
$ dv release --dry-run
Plan: tag core@1.5.0, cli@0.8.1, utils@2.1.0; publish 3 packages
$ dv release --yes
✓ tagged 3 packages, published 3
```

---

## `dv v1`

```
dv v1 <package> [--yes]
```

The 1.0 commitment. Promotes a single pre-1.0 (`Unstable`) Package to
`1.0.0`: a phase-one operation that consumes its pending Records, sets the
Version to `1.0.0`, and commits. Scoped strictly to the `0.x → 1.0.0`
transition — it **errors if the Package is already `≥ 1.0`**.

This command exists because no Record can ever produce a `1.0.0`: the bump
algebra caps `Unstable` Packages below `major` (see
[language.md](language.md) Algebra §3). Crossing 1.0 is therefore always a
deliberate, gated act, never an accident.

| Flag    | Meaning                                            |
| ------- | -------------------------------------------------- |
| `--yes` | Skip the confirmation gate (required in non-TTY).  |

```
$ dv v1 core
About to commit core to 1.0.0 — this is a stability promise. Proceed? [y/N]
```

---

## `dv rename`

```
dv rename <old> <new>
```

Appends a lineage edge `old → new` to `.changelog/renames.yaml` so that
existing Records and release history referencing `old` resolve to `new`.
**Bookkeeping only** — it does not move directories, edit manifests, or
rewrite Records. Equivalent to hand-editing the ledger; the command just
spares you the syntax. See [design.md](design.md) § Renames for why detection
is never automatic.

```
$ dv rename core engine
recorded rename core → engine in .changelog/renames.yaml
```

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
