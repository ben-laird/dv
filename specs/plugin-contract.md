# Plugin contract

`dv`'s extension model is: **a plugin is any executable.** The OS runs it
(shebang lines route to the right interpreter); `dv` communicates with it
via a documented JSON-over-stdio contract.

This document is the canonical reference. Plugins that conform to this
contract — regardless of implementation language — work with `dv`.

## Plugin shape

A plugin is one of:

- **Single executable** that takes the operation name as its first argument:
  `my-plugin discover`, `my-plugin read-version <pkg>`. Convenient for
  one-off shell scripts.
- **Directory of executables** named for the operations: `my-plugin/discover`,
  `my-plugin/read-version`. Convenient for plugins built with an SDK.

Both forms are supported; choose whichever fits.

## Invocation

When `dv` invokes an operation, it:

1. Sets a small set of environment variables (see below).
2. If the operation has a structured payload, writes it as JSON to the
   plugin's stdin.
3. Reads JSON from stdout as the response.
4. Treats stderr as human-readable logs (passed through to the user).
5. Checks the exit code: `0` = success, non-zero = failure.

## Environment variables

Set on every invocation:

| Variable                  | Meaning                                          |
| ------------------------- | ------------------------------------------------ |
| `DV_REPO_ROOT`        | Absolute path to the repo root.                  |
| `DV_PACKAGE_NAME`     | Package this op is acting on. Empty for `discover`. |
| `DV_PACKAGE_PATH`     | Absolute path to the package directory.          |
| `DV_OPERATION`        | Operation name (redundant with argv but handy).  |

Operation-specific variables are listed per-op below.

## Operations

A plugin declares which operations it supports. `discover` is mandatory;
the rest are optional but typical.

The operations are the lifecycle hooks that `dv`'s subtools delegate to
when they need ecosystem-specific behavior (see `design.md` § Capability
decomposition). The mapping:

| Subtool        | Delegates to op(s)                                |
| -------------- | ------------------------------------------------- |
| **discovery**  | `discover`                                        |
| **versioning** | `read-version`, `write-version`, `update-dependency` |
| **publishing** | `release`                                         |

The `records`, `changelog`, and `tagging` subtools need no plugin
delegation — Record parsing and CHANGELOG rendering are format
operations `dv` handles internally, and tagging uses git directly. This
is why the op list is short: plugins only exist to bridge the
ecosystem-specific gaps (where is the version stored? how is a dependency
constraint expressed? how is this package published?), not to reimplement
`dv`'s core logic.

### `discover`

Given a glob (from `.dv/config.yaml`), list the packages that match.

**Input:** `dv` passes the glob via `DV_DISCOVER_GLOB`.

**Output (stdout, JSON):**

```json
{
  "packages": [
    { "name": "core", "path": "packages/core" },
    { "name": "cli",  "path": "packages/cli" }
  ]
}
```

The `name` is what users put in `packages:` in their records. The `path`
is relative to repo root.

### `read-version`

Return the current version of a package.

**Input:** `DV_PACKAGE_NAME`, `DV_PACKAGE_PATH`.

**Output:**

```json
{ "version": "1.2.3" }
```

### `write-version`

Write a new version to the package manifest.

**Input:** `DV_PACKAGE_NAME`, `DV_PACKAGE_PATH`, plus
`DV_NEW_VERSION` (e.g., `"1.3.0"`).

**Output:**

```json
{ "ok": true }
```

### `update-dependency`

Update one package's constraint on another in the manifest. Used by
constraint-only cascading.

**Input:** stdin JSON:

```json
{
  "package": "cli",
  "package_path": "packages/cli",
  "dependency": "core",
  "new_version": "1.3.0"
}
```

The plugin decides how to express the constraint (`^1.3.0`, `~1.3.0`, exact,
etc.) based on what's already in the manifest.

**Output:**

```json
{ "ok": true, "changed": true }
```

`changed: false` is valid — means no change was needed (e.g., the existing
constraint already satisfies the new version, or the dependent does not
carry the dependency at all).

### `release` (optional)

Fired by `dv release` for each package that was bumped, after tags are
minted.

**Input:** `DV_PACKAGE_NAME`, `DV_PACKAGE_PATH`,
`DV_NEW_VERSION`, `DV_GIT_TAG`.

**Output:**

```json
{ "ok": true }
```

What the plugin actually *does* is its business: `npm publish`, `cargo publish`,
`gh release create`, post to Slack, nothing. Failures here do not roll back
the tags (publishing is intentionally side-effectful and idempotency is the
plugin's problem).

## Errors

A plugin signals failure by exiting non-zero and writing a human-readable
error to stderr. Optionally, it can write a structured error to stdout:

```json
{ "ok": false, "error": "manifest not found" }
```

`dv` surfaces the error to the user with the plugin name, operation, and
package as context.

**Timeouts** are a failure mode too. Fast ops (`discover`, `read-version`,
`write-version`, `update-dependency`) are bounded by the assignment's
`timeout` (default 60s); the `release` op is bounded by `publishing.timeout`
(default none). Exceeding the limit terminates the op and is treated as a
failure — surfaced with the same plugin/op/package context, no auto-retry.

## Minimal example: a bash plugin for a hand-rolled VERSION file

```bash
#!/usr/bin/env bash
set -euo pipefail

case "$1" in
  discover)
    # Single package at DV_DISCOVER_GLOB
    name=$(basename "$DV_DISCOVER_GLOB")
    printf '{"packages":[{"name":"%s","path":"%s"}]}\n' "$name" "$DV_DISCOVER_GLOB"
    ;;
  read-version)
    version=$(cat "$DV_PACKAGE_PATH/VERSION")
    printf '{"version":"%s"}\n' "$version"
    ;;
  write-version)
    echo "$DV_NEW_VERSION" > "$DV_PACKAGE_PATH/VERSION"
    echo '{"ok":true}'
    ;;
  *)
    echo "unsupported operation: $1" >&2
    exit 1
    ;;
esac
```

That's a complete plugin. Drop it in `.dv/plugins/version-file` and
wire it up in `config.yaml`:

```yaml
discovery:
  plugins:
    - match: "packages/legacy-thing"
      use:
        path: ./.dv/plugins/version-file
```

## Developing and testing plugins

In v1, every plugin is a hand-written executable (no first-party builtins
yet), so the DX tooling below is what makes authoring tolerable. All of it
works against any executable that follows the contract.

### `dv plugin invoke`

Run a single op against a plugin with controlled inputs — no repo, config,
or records required. Sets the env vars / stdin `dv` would set, and
prints the full exchange plus a conformance check on the response.

```
$ dv plugin invoke ./my-plugin read-version --package core --path packages/core
→ DV_PACKAGE_NAME=core  DV_PACKAGE_PATH=packages/core  DV_OPERATION=read-version
← stdout: {"version":"1.2.3"}   exit: 0
✓ valid read-version response (version=1.2.3)
```

Ops with structured payloads (e.g. `update-dependency`) take the payload
via `--json '{...}'` or stdin. This is the workhorse for iterating on a
plugin op.

### `dv plugin verify`

Automated conformance smoke test, CI-friendly. Checks: the plugin is
resolvable and executable; `discover` is present; each declared op returns
contract-valid JSON for synthetic inputs; bad input produces a non-zero
exit. A plugin author runs this in their own pipeline to guard against
contract drift.

`verify` is only as meaningful as the contract is precise, so each op has
a **versioned response JSON schema** (alongside the config schema). The
schemas make the contract machine-checkable, not just prose.

### `--debug` tracing

A tool-wide flag (on `dv version`, `dv release`, etc.) that logs every
plugin invocation during a real run: op, env vars, stdin, stdout, stderr,
exit code, and duration. The answer to "why did my plugin fail inside
`dv version`."

### Example plugins

`dv` ships **copyable reference plugins** for common ecosystems (Cargo,
npm, pyproject) in an `examples/` directory. These are starting points to
adapt, **not** maintained dependencies — copy one into your repo and tweak
it. Promoting any of them to a real first-party builtin (with a support
commitment) remains a separate, deliberate future step.

## Future surface (not v1)

- **SDKs** for TypeScript, Rust, Python — typed wrappers over the same
  contract.
- **YAML inline plugins** — declarative "to read version, parse field X of
  file Y" config, internally lowered to an ephemeral executable.
- **First-party builtins** — Cargo, npm, pyproject, Maven, Go modules
  (promoted from the copyable examples, with a maintenance commitment).
- **`dv plugin new`** — scaffold a starter plugin. Considered for v1,
  deferred; the example plugins cover the "where do I start" need for now.

All layered on the same JSON contract above.
