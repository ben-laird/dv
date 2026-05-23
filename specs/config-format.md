# Config file format

`dv` is configured by `.dv/config.yaml` at the repo root. This
document is the canonical reference for that file.

The config is organized by **subtool** — `dv` is built as a set of
independent capability modules (discovery, records, versioning,
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
records: {}
changelog: {}
history: {}
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
      use:
        builtin: cargo
    - match: "apps/*"
      use:
        builtin: npm
    - match: "tools/migrator"
      use:
        path: ./scripts/custom-version
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
      use:
        builtin: cargo
```

### Plugin resolution

`use` is a tagged object — **exactly one** of `path:`, `builtin:`,
`command:`, or `run:` must be set. The discriminator makes the source
of the plugin explicit in the YAML, rather than being inferred from
the shape of a single overloaded string. Parsers can tell what kind
of reference they're looking at without heuristics.

```yaml
discovery:
  plugins:
    - match: "apps/*"
      use:
        path: ./examples/plugins/deno     # local file or directory
    - match: "crates/*"
      use:
        builtin: cargo                    # first-party plugin (none ship in v1)
    - match: "tools/*"
      use:
        command: my-plugin                # binary found on $PATH
    - match: "scripts/*"
      use:
        run: deno run -A jsr:@sekhmet/some-plugin  # full invocation string
```

- **`path`** — A local file or directory. Relative paths resolve
  against the repo root. `./`, `../`, `/`, and `~/` are all accepted.
  A directory plugin lays out one executable per Op (`discover`,
  `read-version`, …); a file plugin is invoked once per Op with the
  op name as `argv[1]`.
- **`builtin`** — The name of a first-party plugin that ships with
  `dv`. **v1 ships no builtins**; any `builtin:` entry will error with
  `plugin-not-found` until first-party plugins land. Reserved now so
  configs are forward-compatible.
- **`command`** — A binary name to look up on `$PATH`. Useful when a
  plugin is installed via `brew`, `cargo install`, `deno install`, etc.
  The lookup uses `$PATHEXT` on Windows for `.cmd`/`.exe` resolution;
  otherwise just the bare name.
- **`run`** — A full invocation string. The value is POSIX-tokenized
  (the same rules `$EDITOR` follows): quoted strings, `\`-escapes,
  whitespace as token separator. The **first token** is the
  executable; the **remaining tokens** are static args that prefix
  every invocation. The Op name (`discover`, `read-version`, …) is
  appended as the final argument. Use `run:` when your plugin needs
  an interpreter or static arguments that ride with every call.

  Example: `deno run -A jsr:@sekhmet/some-plugin` produces
  `deno run -A jsr:@sekhmet/some-plugin discover` for the discover
  Op, `deno run -A jsr:@sekhmet/some-plugin read-version` for the
  read-version Op, and so on. Variable expansion (`$VAR`) and
  command substitution (`` `cmd` ``) are deliberately not performed
  — `run:` is a tokenized invocation, not a shell line.

Setting more than one key on the same `use:` is a config error
(`config-shape`). The "exactly one of" rule is enforced by the Zod
schema before any resolution runs.

#### When to pick which

The two arms most likely to confuse each other are `command` and
`run`:

- **`command: my-plugin`** — one binary, no static args. dv resolves
  it on `$PATH` up front and spawns it directly. Choose this when
  your plugin is a real binary the user installed (`brew install
  my-plugin`, `cargo install my-plugin`, etc.).
- **`run: deno run -A jsr:@scope/foo`** — multiple tokens (an
  interpreter + flags + a script reference). Choose this when you'd
  otherwise need to wrap the invocation in a shell script just to
  bundle the static args. The Sekhmet-style "every script is a JSR
  package" pattern lands here.

`path:` is for things on the filesystem; `builtin:` is reserved.

#### Migrating from the pre-1.0 string form

Earlier pre-1.0 versions of `dv` accepted a single string at `use:`,
with the kind inferred from string shape (`./foo` was a path, anything
else was a builtin name). That overload was removed because
configurations could not be unambiguously parsed from the YAML alone.

If you see `config-legacy-use-shape` when running any `dv` command,
your config still uses the old string form. Run:

```sh
dv migrate config
```

to rewrite the file in place. The migrator preserves the original kind
inferred from the string shape — path-shaped strings become `path:`,
others become `builtin:` — and is idempotent: running it on an already-
migrated config is a no-op.

### Per-assignment options

Each plugin entry accepts an optional `timeout`:

```yaml
discovery:
  plugins:
    - match: "packages/*"
      use:
        builtin: cargo
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

## `records`

Behavior of the records subtool (authoring, parsing, validation,
consumption of Record files).

```yaml
records:
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

## `history`

Optional long-form companion document to `CHANGELOG.md`. CHANGELOG stays terse
per Keep a Changelog conventions (single-line bullets); HISTORY carries each
Record's full body prose under `### Headline` subsections, grouped by version.
The two documents are complementary: agents and humans scan CHANGELOG for
"what shipped" and HISTORY for "why these decisions."

```yaml
history:
  enabled: false
  location: "{package-path}/HISTORY.md"
```

| Key        | Type    | Default                        | Meaning                                                                         |
| ---------- | ------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `enabled`  | boolean | `false`                        | Write HISTORY.md during `dv version`. Default off; existing repos opt in.       |
| `location` | string  | `"{package-path}/HISTORY.md"`  | Where to write each Package's HISTORY. Supports the same template vars.         |

Format:

```markdown
# History

## [1.5.0] - 2026-05-22

### Add OAuth device flow

Clients without a browser (CLIs, embedded devices) can now authenticate
using the device authorization grant.

### Patch the parser

(...record body prose...)
```

Records are expected to lead with an `# Headline` line (see
`record-format.md` § Body) — the renderer strips the leading `#` for the
h3 title and emits the body below it as the entry content. Records without
an h1 (the pre-v1 convention) fall back to the first non-empty line as the
title.

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
  plugin:
    path: ./scripts/release-handler
  timeout: none
```

`plugin` follows the same discriminated shape as
`discovery.plugins[].use` — exactly one of `path:`, `builtin:`, or
`command:`. See [Plugin resolution](#plugin-resolution) for the kinds.

| Key       | Type              | Default  | Meaning                                                                                                                                            |
| --------- | ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin`  | plugin reference  | *(none)* | Optional plugin invoked per package after tagging. Same `{path,builtin,command}` shape as `discovery.plugins[].use`.                               |
| `timeout` | duration / `none` | `none`   | Max wall-clock for the `release` op. Default none — publishing is slow and variable. Set a duration (e.g. `5m`) to bound it.                       |

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
      plugin:
        path: ./scripts/special-release
```

### Override-able sections

- `changelog` (all keys)
- `history` (all keys)
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
      use:
        builtin: cargo
    - match: "apps/*"
      use:
        builtin: npm
    - match: "tools/migrator"
      use:
        path: ./scripts/version-from-VERSION-file
  use-gitignore: true

changelog:
  location: "{package-path}/CHANGELOG.md"

tagging:
  format: "{package}@{version}"

publishing:
  plugin:
    path: ./scripts/release-handler

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
