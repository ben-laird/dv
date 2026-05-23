# Walkthrough

`dv` end to end on a small polyglot monorepo — from an uninitialized repo to
cut Tags and published Packages. Terms (Record, Bump, Stability, Plan, Tag)
are defined in [language.md](language.md); commands are detailed in
[cli.md](cli.md). This is the narrative version: read it once and the rest of
the docs slot into place.

## The repo

A two-ecosystem monorepo — a Rust core and CLI, plus a TypeScript dashboard:

```
acme/
├── packages/
│   ├── core/        Cargo.toml   (acme-core, 0.3.1)
│   └── cli/         Cargo.toml   (acme-cli,  0.3.1, depends on acme-core)
└── tools/
    └── dashboard/   package.json (dashboard, 1.2.0)
```

Note the mixed Stability: the Rust crates are `Unstable` (`0.x`), the
dashboard is `Stable` (`≥ 1.0`). `dv` treats each Package on its own terms.

## 1. Initialize

```
$ dv init
created .dv/config.yaml
created .dv/records/
```

## 2. Configure discovery

`dv` finds Packages by running Plugins against path globs. Point the Rust
crates at a `cargo` Plugin and the dashboard at an `npm` Plugin, and set a
release Plugin for publishing. Edit `.dv/config.yaml`:

```yaml
discovery:
  plugins:
    - match: "packages/*"
      use: ./.dv/plugins/cargo
    - match: "tools/*"
      use: ./.dv/plugins/npm

publishing:
  plugin: ./.dv/plugins/publish
```

(The example Plugins shipped with `dv` are copyable starting points — see
[plugin-contract.md](plugin-contract.md).) Confirm discovery:

```
$ dv status --all
No pending records.

Packages (3):
  acme-core   0.3.1   packages/core
  acme-cli    0.3.1   packages/cli
  dashboard   1.2.0   tools/dashboard
```

## 3. File some Records

A contributor adds a feature to `core` and fixes a bug in `cli`. Each change
is one Record:

```
$ dv add --type feat --packages acme-core \
         --message "Add streaming parser for large manifests"
created .dv/records/brave-otters-wander.md

$ dv add --type fix --packages acme-cli \
         --message "Exit non-zero when no input file is given"
created .dv/records/quiet-cats-sneeze.md
```

A Record is just a committed markdown file. `brave-otters-wander.md`:

```markdown
---
type: feat
packages:
  - acme-core
---

Add streaming parser for large manifests
```

These get committed alongside the PR like any other change. Nothing has
bumped yet — Records are pending intent.

## 4. See what will happen

```
$ dv status
Pending Records — 2 records, 2 packages (run `dv version`):
  acme-core   0.3.1 → 0.4.0   minor   (1 feat)
  acme-cli    0.3.1 → 0.3.2   patch   (1 fix)

Awaiting release — none.
```

`acme-core` gets a `minor` (a `feat`), `acme-cli` a `patch` (a `fix`). Both
are `Unstable`, so even a breaking change would have capped at `minor` —
neither can reach `1.0.0` this way (that's what `dv v1` is for).

## 5. Version (phase one)

Preview the Plan with zero side effects first:

```
$ dv version --dry-run
Plan:
  bump acme-core 0.3.1 → 0.4.0 (minor)
  bump acme-cli  0.3.1 → 0.3.2 (patch)
  update acme-cli's dependency constraint on acme-core → 0.4.0
  prepend 2 CHANGELOG sections
  delete 2 records
  1 commit (no push)
```

Note the **constraint-only cascade**: `acme-cli` depends on `acme-core`, so
its manifest constraint is rewritten to `0.4.0` — but `acme-cli` is *not*
itself bumped for that reason (only its own `fix` bumped it). Now run it:

```
$ dv version
✓ versioned 2 packages
✓ updated 1 dependency constraint
✓ committed: chore(release): version packages
```

`packages/core/CHANGELOG.md` now starts:

```markdown
## 0.4.0

### Features
- Add streaming parser for large manifests
```

The consumed Records are gone from `.dv/records/`, and the whole thing
is one commit — the **Release PR**. Open it, review it, merge it.

## 6. Release (phase two)

After the Release PR merges, cut Tags and publish. `dv release` is
**stateless**: it compares each Package's current Version to existing Tags
and acts on whatever is untagged.

```
$ dv release --dry-run
Plan:
  tag acme-core@0.4.0   then publish
  tag acme-cli@0.3.2    then publish
  (dashboard 1.2.0 already tagged — skipped)

$ dv release --yes
✓ tagged acme-core@0.4.0, acme-cli@0.3.2
✓ published 2 packages
```

`dashboard` was untouched this cycle, already had its Tag, and was skipped —
no state file consulted, just Tags. If a publish had failed midway, you'd
re-run `dv release` (or `--force` for an already-tagged Package) and it would
pick up exactly where it left off.

## 7. Later: committing to 1.0

When `acme-core` is ready to promise stability, the milestone is explicit —
it can't happen by accident:

```
$ dv v1 acme-core
About to commit acme-core to 1.0.0 — this is a stability promise. Proceed? [y/N] y
✓ acme-core → 1.0.0, committed
```

On the next `dv release`, the first `1.0.0` Tag is detected and celebrated.
From here on, `acme-core` is `Stable`: a breaking change (`feat!` / `fix!`)
will bump it to `2.0.0` rather than capping at `minor`.

## Where to go next

- [cli.md](cli.md) — every flag on every command used above.
- [record-format.md](record-format.md) — the full Record file format.
- [config-format.md](config-format.md) — everything configurable.
- [plugin-contract.md](plugin-contract.md) — write the `cargo` / `npm` /
  `publish` Plugins this walkthrough assumed.
