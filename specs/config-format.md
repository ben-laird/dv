# Config file format

`dv` is configured by `.changelog/config.yaml` at the repo root. This
document is the canonical reference for that file.

The config is organized by **subtool** — `dv` is built as a set of
independent capability modules (discovery, changesets, versioning,
changelog, tagging, publishing), and each subtool with user-facing
options owns a top-level config section. Git operations are the shared
substrate every subtool persists through, so they get a dedicated `git`
section rather than being scattered. CLI commands are orchestrations of
subtools and don't have config sections of their own. See `design.md` §
Capability decomposition for the architecture.

All keys are kebab-case to match YAML norms. The structure (top-level
sections, `extends`, `overrides`, versioned `$schema`) takes after
Biome's `biome.json`.

## Top-level shape

```yaml
$schema: https://dv.dev/schema/v1.yaml

extends: []

# Subtools (capabilities)
discovery: {}
changesets: {}
changelog: {}
tagging: {}
publishing: {}

# Substrate + global
git: {}
safety: {}

overrides: []
```

Every section is optional except `discovery` (which holds the plugin
assignments that define what packages exist). An empty or missing config
means "no packages tracked"; `dv` exits cleanly without doing anything.

A note on `versioning`: it is a real subtool in the code, but its policies
(strict pre-1.0, constraint-only cascade) are locked and not
user-configurable in v1, so it has no config section.

## `$schema`

Recommended for editor support. Points at the versioned JSON Schema:

```yaml
$schema: https://dv.dev/schema/v1.yaml
```

VS Code with the YAML extension (and most other modern editors) will pick
this up automatically and provide autocomplete and validation.

## `extends`

Inherit configuration from one or more other configs. Entries are merged
in order; later entries override earlier ones. The local file's values
override anything from `extends`.

```yaml
extends:
  - ./shared/dv-base.yaml             # local relative path
  - /etc/dv/org-defaults.yaml         # absolute path
  - "@myorg/dv-config-base"           # eventually: registry reference
```

Supported sources:

- **Local paths** (relative or absolute) — always supported.
- **Registry references** — supported once `dv` has an SDK / publishing
  story. Not in v1.
- **HTTPS URLs** — explicitly not supported. Pulling executable
  configuration from a remote URL is a supply-chain hazard for a tool
  that writes manifests and mints tags.

`extends` cannot appear inside an `overrides` entry.

## `discovery`

Enumerates packages and resolves which plugin manages each. The
`plugins` list is the source of truth for which packages exist.

```yaml
discovery:
  plugins:
    - match: "packages/*"
      use: cargo
    - match: "apps/*"
      use: npm
    - match: "tools/migrator"
      use: ./scripts/custom-version
  use-gitignore: true
```

| Key             | Type    | Default | Meaning                                                                    |
| --------------- | ------- | ------- | -------------------------------------------------------------------------- |
| `plugins`       | list    | *(req)* | Plugin assignments. See below.                                             |
| `use-gitignore` | boolean | `true`  | If true, `.gitignore` is honored during discovery — ignored paths skipped. |

### Match semantics

`match` is one of:

- A string glob: `"packages/*"`
- A list of globs: `["packages/*", "!packages/legacy"]`

The string form is shorthand for a single-element list. Negation with `!`
prefix excludes paths within an otherwise-matching glob, gitignore-style.

```yaml
discovery:
  plugins:
    - match:
        - "packages/*"
        - "!packages/internal-experiment"
      use: cargo
```

### Plugin resolution

`use` accepts:

- **Path to executable**: `./scripts/custom-version`, `/usr/local/bin/my-plugin`
- **Builtin name**: `cargo`, `npm`, `pyproject` (once first-party plugins ship)

Resolution order: explicit path first; if `use` doesn't start with `./`,
`/`, or `~`, it's looked up in the builtin registry.

### Per-assignment options

Each plugin entry accepts an optional `timeout`:

```yaml
discovery:
  plugins:
    - match: "packages/*"
      use: cargo
      timeout: 60s            # max duration for this plugin's fast ops
```

| Key       | Type     | Default | Meaning                                                                                                              |
| --------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `timeout` | duration | `60s`   | Max wall-clock for this plugin's fast ops (`discover`, `read-version`, `write-version`, `update-dependency`). Exceeding it is a failed op. |

The `release` op is *not* governed by this — publishing is legitimately
slow and variable. Its timeout (default: none) lives under `publishing`.

### Matching rules

- Every package directory found by a plugin's `discover` op must be
  claimed by exactly one plugin entry.
- If a package directory matches no plugin entry, it is **not tracked**
  by `dv` — silently. This is the intended exclusion mechanism.
- If a package matches multiple plugin entries, `dv` errors at startup
  with the conflicting entries listed.

## `changesets`

Behavior of the changesets subtool (authoring, validation, consumption).

```yaml
changesets:
  auto-stage: true                # git add the file created by `dv add`
```

| Key          | Type    | Default | Meaning                                                                                                          |
| ------------ | ------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `auto-stage` | boolean | `true`  | If true, `dv add` runs `git add` on the newly-created record file. Overridable per-invocation with `--no-stage`. |

## `changelog`

How CHANGELOG files are rendered.

```yaml
changelog:
  format: keep-a-changelog
  location: "{package-path}/CHANGELOG.md"
```

| Key        | Type   | Default                         | Meaning                                                          |
| ---------- | ------ | ------------------------------- | ---------------------------------------------------------------- |
| `format`   | string | `keep-a-changelog`              | Output format. v1 supports only `keep-a-changelog`.              |
| `location` | string | `"{package-path}/CHANGELOG.md"` | Where to write each package's CHANGELOG. Supports template vars. |

## `tagging`

How git tags are formatted.

```yaml
tagging:
  format: "{package}@{version}"
```

| Key      | Type   | Default                 | Meaning                                                            |
| -------- | ------ | ----------------------- | ------------------------------------------------------------------ |
| `format` | string | `"{package}@{version}"` | Format for git tags minted by `dv release`. Supports template vars.|

## `publishing`

How release plugins are invoked after tagging.

```yaml
publishing:
  plugin: ./scripts/release-handler
  timeout: none
```

| Key       | Type             | Default  | Meaning                                                                                       |
| --------- | ---------------- | -------- | --------------------------------------------------------------------------------------------- |
| `plugin`  | string           | *(none)* | Optional executable invoked per package after tagging. See plugin docs.                       |
| `timeout` | duration / `none`| `none`   | Max wall-clock for the `release` op. Default none — publishing is slow and variable. Set a duration (e.g. `5m`) to bound it. |

## `git`

The shared substrate every subtool persists through. Holds all git
behavior, including operations that span multiple subtools (the `version`
commit bundles versioning, changelog, and record changes into one
commit, so `auto-commit` can't belong to any single capability).

```yaml
git:
  require-clean-tree: true
  sign: auto
  auto-commit: true
  commit-message-template: |
    chore(release): {summary}

    {details}
  auto-push: false
  push-sequence: publish-then-push
```

| Key                       | Type    | Default             | Meaning                                                                                                                  |
| ------------------------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `require-clean-tree`      | boolean | `true`              | If true, `dv version` and `dv release` refuse to run with uncommitted changes.                                           |
| `sign`                    | enum    | `auto`              | Commit/tag signing. `auto` honors git's own config (`commit.gpgsign`, `tag.gpgsign`); `true` forces signing; `false` disables. |
| `auto-commit`             | boolean | `true`              | If true, `dv version` commits its changes. If false, changes are staged for the user to commit. `--no-commit` overrides. |
| `commit-message-template` | string  | *(see below)*       | Template for the auto-commit message. Supports `{summary}` and `{details}`.                                              |
| `auto-push`               | boolean | `false`             | If true, `dv release` pushes minted tags to the remote. Overridable with `--push` / `--no-push`.                         |
| `push-sequence`           | enum    | `publish-then-push` | Order of operations when pushing is enabled. `publish-then-push` or `push-then-publish`. See below.                      |

Default `commit-message-template`:

```
chore(release): {summary}

{details}
```

Commit-message template variables (repo-level, distinct from the
per-package variables used in `tagging.format` / `changelog.location`):

| Variable    | Value                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| `{summary}` | One-line list of bumped packages, e.g. `core 1.3.0, cli 0.4.2, web 2.1.0`.  |
| `{details}` | Multi-line bullet list: `- core 1.2.5 → 1.3.0 (1 feat, 2 fix)` per package. |

`push-sequence` only takes effect when pushing is enabled (`auto-push:
true` or `--push`):

- **`publish-then-push`** (default) — mint tags locally, run release
  plugins, then push tags. If a plugin fails, tags stay local and the
  remote is untouched, so the user can fix and retry without polluting
  the remote.
- **`push-then-publish`** — mint tags locally, push, then run release
  plugins. Treats the pushed tag as the source of truth; release plugins
  are expected to be idempotent.

## `safety`

Repo-wide safety defaults that affect how destructive commands behave by
default. Every option is overridable per-invocation by the corresponding
flag.

```yaml
safety:
  dry-run-by-default: false
```

| Key                  | Type    | Default | Meaning                                                                                                                                            |
| -------------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dry-run-by-default` | boolean | `false` | When true, every destructive command (`version`, `release`) defaults to `--dry-run`. Pass `--no-dry-run` or `--dry-run=false` to override per-run. |

When `dry-run-by-default` is true, `dv` prints a prominent banner at the
top of each invocation indicating the source of the dry-run mode, so the
user is never confused about whether changes will land.

Use cases this is intended for:

- **Onboarding** — a team adopting `dv` can flip this on while they
  develop intuition for the workflow, then flip it off.
- **High-stakes repos** — repos where every release should require
  explicit "yes I mean it" beyond the confirmation prompt.

## `overrides`

Per-package customization. Each entry has a `match` (same syntax as
`discovery.plugins[].match`) plus any subset of the override-able
subtool sections.

```yaml
overrides:
  - match: "packages/core"
    tagging:
      format: "{version}"              # core uses bare version tags

  - match: ["apps/cli", "apps/web"]
    changelog:
      location: "{package-path}/HISTORY.md"

  - match: "tools/migrator"
    publishing:
      plugin: ./scripts/special-release
```

### Override-able sections

- `changelog` (all keys)
- `tagging` (all keys)
- `publishing` (all keys)
- The plugin assignment for a package (via `use:` at the override level)

These are all per-package concerns — each package gets its own tag,
changelog, and release-plugin invocation.

### Not override-able

- `git` — repo-global; the commit and push span all packages at once.
- `safety` — repo-global.
- `discovery.use-gitignore`, `discovery.plugins` (as a whole) — repo-global.
- `extends`, `$schema`.

### Resolution order

**First match wins.** If a package matches multiple override entries, only
the first one applies. Order entries from most-specific to least-specific.

## Template variables

Available inside string options that accept interpolation
(`tagging.format`, `changelog.location`, etc.):

| Variable          | Value                                                |
| ----------------- | ---------------------------------------------------- |
| `{package}`       | Package name as reported by the plugin's `discover`. |
| `{version}`       | The new version being written.                       |
| `{package-path}`  | Package directory, relative to repo root.            |

(The `git.commit-message-template` variables `{summary}` and `{details}`
are repo-level and documented under `git` above.)

## Full example

```yaml
$schema: https://dv.dev/schema/v1.yaml

discovery:
  plugins:
    - match:
        - "packages/*"
        - "!packages/internal-*"
      use: cargo
    - match: "apps/*"
      use: npm
    - match: "tools/migrator"
      use: ./scripts/version-from-VERSION-file
  use-gitignore: true

changelog:
  location: "{package-path}/CHANGELOG.md"

tagging:
  format: "{package}@{version}"

publishing:
  plugin: ./scripts/release-handler

git:
  require-clean-tree: true
  auto-commit: true
  auto-push: false

overrides:
  - match: "packages/core"
    tagging:
      format: "v{version}"

  - match: "apps/cli"
    changelog:
      location: "{package-path}/HISTORY.md"
```

## Validation

`dv validate` checks (in addition to the record-format checks in
`record-format.md`):

- Config parses as YAML.
- Required sections are present (`discovery.plugins`).
- Unknown keys are rejected (typo-catching).
- `extends` chain resolves and is acyclic.
- Glob patterns are syntactically valid.
- Every discovered package matches exactly one plugin entry.
- Override `match` patterns reference at least one discovered package
  (warning, not error — could be intentional).
