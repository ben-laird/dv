# deno — example plugin

A reference plugin for Deno workspaces (packages with a `deno.json` or
`deno.jsonc` carrying a `name`; a missing `version` reads as `0.0.0`). Copy `main.ts` into your own repo and adapt — it is
not a maintained dependency (`examples/CLAUDE.md`).

## Wiring it up

`.dv/config.yaml`:

```yaml
discovery:
  plugins:
    - match:
        - "apps/*"
        - "packages/*"
      use:
        run: deno run -A ./examples/plugins/deno/main.ts
```

The `run:` reference arm tells dv to invoke the script via `deno run` with
the Op name appended as the final argument. No shebang, no `chmod +x`, no
filesystem-mode bit to keep track of as the file moves between repos.
[specs/config-format.md § Plugin resolution](../../../specs/config-format.md#plugin-resolution)
covers the four arms and when to pick which.

## What it implements

- `discover` — walks the glob in `DV_DISCOVER_GLOB`, returns every directory
  with a `deno.json` (or `deno.jsonc`) whose `name` field is set. The
  Package name is that field; the path is relative to `DV_REPO_ROOT`.
- `read-version` — reads the manifest's `version` field. Manifests without a
  `version` field report `"0.0.0"` (the documented "no version yet"
  default; dv's algebra treats `0.0.0` as Unstable).
- `write-version` — sets the manifest's `version` field to `DV_NEW_VERSION`
  by editing the value **in place in the original text**: indentation
  (tabs or spaces), blank-line grouping, key order, and `deno.jsonc`
  comments survive byte-for-byte, so the release commit passes a Biome /
  `deno fmt` gate. A missing `version` is inserted after `name`, indented
  like its siblings. Every edit is re-parsed to prove it produced valid
  JSON(C) and set the intended value.
- `update-dependency` — rewrites `imports[<dependency>]` in the manifest
  (same in-place edit) to point at the new version. Preserves any existing range prefix (`^`,
  `~`) and defaults to caret (`^`) for unrecognized forms — the modern
  Deno convention. Manifests with no `imports` map, or no entry for the
  named dependency, return `{ ok: true, changed: false }` — the documented
  no-op path of the cascade. Workspace members that import each other
  without an `imports` entry have no constraint to rewrite, so they take
  this path too.
- `get-dependencies` — reports which `candidates` this package depends on,
  so `dv release` publishes dependencies first. Unions two sources: the
  manifest's `imports` keys, and the module graph from
  `deno info --json` run on each `exports` entry point. The graph catches
  what the import map can't: Deno workspace members import each other by
  name with no `imports` entry. Every local module in the graph is mapped
  to the member owning it: the nearest `deno.json`/`deno.jsonc` above the
  file that has a `name`. Nameless manifests on the way up, such as a
  nested tool config, are skipped. The walk runs with `--no-remote --no-npm --no-lock`, so it is
  offline and never writes `deno.lock`. The whole walk shares one
  45-second budget across every entry point, which leaves headroom
  inside the fixed 60-second timeout dv release gives the whole op. A
  `deno info` still running when the budget expires is killed. If the package's graph can't be built (`deno info` exits
  non-zero, for example on a missing or gitignored generated entry
  point; a local module won't load; or the budget runs out), the op
  still succeeds with the import-map dependencies alone and writes a
  warning to stderr naming the package and the `deno info` error. The
  contract treats stderr as free-form logs that dv passes through to
  the user. If `deno` itself is broken (it can't be started, or prints
  output that isn't a module graph), the op fails with
  `{ ok: false, error }` instead, since falling back would hide a broken
  setup.
- `finalize` — runs `deno install` to refresh `deno.lock` and reports it
  in `additionalChangedFiles` whenever it differs from `HEAD`.
- `release` — publishes the package to JSR with
  `deno publish --allow-dirty --quiet`, run from the package directory.
  It passes no `--token`: on a GitHub Actions workflow JSR trusts,
  `deno publish` uses OIDC on its own. A successful publish reports
  `{ ok: true, published: true }`. A failed publish reports
  `{ ok: false, message }` (with `deno publish`'s stderr) and exits 0:
  per `specs/plugin-contract.md`, a release-op failure does NOT roll back
  the tag, so dv records the outcome, carries on with the other packages,
  and `dv release --force` retries once the cause is fixed.
  A package whose manifest sets `"publish": false` (Deno's marker for a
  workspace member that never goes to JSR) is skipped with
  `{ ok: true, published: false, message }`, and `deno publish` is never
  run. dv has already versioned and tagged it by then. The contract has
  no way for a plugin to say "don't tag this package", so the tag still
  marks the release in git.

## How

Single-file dispatcher: `main.ts` switches on `Deno.args[0]` (the Op name dv
appends) and routes to the per-Op handler function. JSON-over-stdio per
`specs/plugin-contract.md`. Imports JSR std modules inline
(`jsr:@std/path`, `jsr:@std/fs`, `jsr:@std/jsonc`) so no separate `deno.json` for the plugin
directory is needed — copy `main.ts` into your repo and the script is
self-contained.

## Adapting

The most common adaptations:

- **Switch to `npm:` / `cargo` / `pyproject` manifests** — replace the
  `deno.json` reads/writes with the manifest format your packages use.
  The Op surfaces (`discover` returns `{ name, path }`; `read-version`
  returns `{ version }`; etc.) don't change.
- **Publish somewhere other than JSR** — swap the `deno publish` command
  in `runRelease` for whatever your registry needs (`npm publish`,
  `gh release create`, …). The function gets `DV_PACKAGE_NAME`,
  `DV_NEW_VERSION`, `DV_GIT_TAG`, and `DV_PACKAGE_PATH` in env vars.
- **Lock down permissions** — `deno run -A` grants everything for
  simplicity. A real plugin can narrow to just what it needs, e.g.
  `deno run --allow-read --allow-env --allow-write ...`.
