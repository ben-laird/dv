# deno — example plugin

A reference plugin for Deno workspaces (packages with a `deno.json` or
`deno.jsonc` carrying a `name` and `version`). Copy `main.ts` into your own repo and adapt — it is
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
