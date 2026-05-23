# deno — example plugin

A reference plugin for Deno workspaces (packages with a `deno.json` carrying
a `name` and `version`). Copy `main.ts` into your own repo and adapt — it is
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
  with a `deno.json` whose `name` field is set. The Package name is that
  field; the path is relative to `DV_REPO_ROOT`.
- `read-version` — reads `deno.json`'s `version` field. Manifests without a
  `version` field report `"0.0.0"` (the documented "no version yet"
  default; dv's algebra treats `0.0.0` as Unstable).
- `write-version` — sets `deno.json`'s `version` field to `DV_NEW_VERSION`.
  Preserves other fields and their insertion order; output is JSON with
  2-space indent and a trailing newline. Acceptable for the example because
  `deno.json` files in this repo don't carry root-level comments — a real-
  world plugin handling comment-bearing manifests would do surgical line
  edits.
- `update-dependency` — rewrites `imports[<dependency>]` in `deno.json` to
  point at `DV_NEW_VERSION`. Preserves any existing range prefix (`^`,
  `~`) and defaults to caret (`^`) for unrecognized forms — the modern
  Deno convention. Manifests with no `imports` map, or no entry for the
  named dependency, return `{ ok: true, changed: false }` — the documented
  no-op path of the cascade.
- `release` — **stub** that reports `{ok: true, published: false}` with a
  message naming the package + version it would have published. Real
  plugins replace this with `deno publish`, `npm publish`,
  `cargo publish`, `gh release create`, posts to Slack, etc. The stub
  exists so `dv release` can complete the tag-minting + plugin-dispatch
  path end-to-end without actually pushing to a registry. Per
  `specs/plugin-contract.md`, a release-op failure does NOT roll back
  the tag — the plugin's job is to be idempotent (or at least safe to
  re-run via `dv release --force`).

## How

Single-file dispatcher: `main.ts` switches on `Deno.args[0]` (the Op name dv
appends) and routes to the per-Op handler function. JSON-over-stdio per
`specs/plugin-contract.md`. Imports JSR std modules inline
(`jsr:@std/path`, `jsr:@std/fs`) so no separate `deno.json` for the plugin
directory is needed — copy `main.ts` into your repo and the script is
self-contained.

## Adapting

The most common adaptations:

- **Switch to `npm:` / `cargo` / `pyproject` manifests** — replace the
  `deno.json` reads/writes with the manifest format your packages use.
  The Op surfaces (`discover` returns `{ name, path }`; `read-version`
  returns `{ version }`; etc.) don't change.
- **Implement `release` properly** — replace the stub with whatever
  publishing command your registry needs. The function gets
  `DV_PACKAGE_NAME`, `DV_NEW_VERSION`, `DV_GIT_TAG`, and `DV_PACKAGE_PATH`
  in env vars.
- **Lock down permissions** — `deno run -A` grants everything for
  simplicity. A real plugin can narrow to just what it needs, e.g.
  `deno run --allow-read --allow-env --allow-write ...`.
