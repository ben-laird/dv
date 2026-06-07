# npm — example plugin

A reference plugin for npm packages (directories with a `package.json` carrying
a `name` and `version`). Copy `main.ts` into your own repo and adapt — it is not
a maintained dependency (`examples/CLAUDE.md`).

It is written as a Deno script for zero install footprint and symmetry with the
`deno` example, but the contract is JSON-over-stdio and language-agnostic: a real
npm shop could rewrite this as a Node script (or `bash` + `jq`) and dv wouldn't
notice. The contract is what matters; the implementation language is yours.

## Wiring it up

`.dv/config.yaml`:

```yaml
discovery:
  plugins:
    - match:
        - "apps/*"
        - "packages/*"
      use:
        run: deno run -A ./examples/plugins/npm/main.ts
```

The `run:` reference arm tells dv to invoke the script via `deno run` with the
Op name appended as the final argument. No shebang, no `chmod +x`, no
filesystem-mode bit to keep track of as the file moves between repos.
[specs/config-format.md § Plugin resolution](../../../specs/config-format.md#plugin-resolution)
covers the four arms and when to pick which.

## What it implements

The full op set, targeting `package.json` throughout.

- `info` — mandatory. Reports `contractVersion`, the `supportedOps` list, and
  the plugin `name`/`version`. dv invokes it once per run to learn the contract
  version and which Ops it may call.
- `discover` — walks the glob in `DV_DISCOVER_GLOB`, returns every directory
  with a `package.json` whose `name` field is set. The Package name is that
  field; the path is relative to `DV_REPO_ROOT`.
- `read-version` — reads `package.json`'s `version` field. Manifests without a
  `version` report `"0.0.0"` (the documented "no version yet" default; dv's
  algebra treats `0.0.0` as Unstable).
- `write-version` — sets `package.json`'s `version` to `DV_NEW_VERSION`,
  preserving other fields and their order; output is JSON with 2-space indent
  and a trailing newline. Acceptable for the example because the `package.json`
  files here carry no root-level comments (npm manifests can't); a plugin
  handling exotic manifests would do surgical edits.
- `update-dependency` — rewrites the named dependency's constraint across all
  four constraint-bearing maps (`dependencies`, `devDependencies`,
  `peerDependencies`, `optionalDependencies`) to point at `DV_NEW_VERSION`.
  Preserves any existing range prefix (`^`, `~`) and defaults to caret for
  unrecognized forms. `bundledDependencies` (a bare name list) and `overrides`
  (its own DSL) are intentionally skipped. A manifest with no matching entry
  returns `{ ok: true, changed: false }` — the no-op path of the cascade.
- `get-dependencies` — reports the package's intra-workspace dependencies by
  walking the same four maps and intersecting with the candidate set dv passes
  in. Lets dv build the constraint-cascade graph.
- `release` — **stub** that reports `{ ok: true, published: false }` with a
  message naming the package + version it would have published. Replace it with
  `npm publish` (the function gets `DV_PACKAGE_NAME`, `DV_NEW_VERSION`,
  `DV_GIT_TAG`, `DV_PACKAGE_PATH`). Per `specs/plugin-contract.md`, a release-op
  failure does NOT roll back the tag — the plugin's job is to be idempotent (or
  safe to re-run via `dv release --force`).
- `finalize` — runs `npm install --package-lock-only` so `package-lock.json`
  refreshes in the **same commit** as the version/manifest edits, instead of
  drifting until the next unrelated install. It detects whether the repo is an
  npm workspace (root lockfile) or per-package (a lockfile beside each
  `package.json`) and runs in the right directory; it reports each changed
  `package-lock.json` in `additionalChangedFiles` only when it actually differs
  from `HEAD`.

## How

Single-file dispatcher: `main.ts` switches on `Deno.args[0]` (the Op name dv
appends) and routes to the per-Op handler. JSON-over-stdio per
`specs/plugin-contract.md`. Imports JSR std modules inline (`jsr:@std/path`,
`jsr:@std/fs`) so no separate `deno.json` for the plugin directory is needed —
copy `main.ts` into your repo and the script is self-contained.

## Adapting

The most common adaptations:

- **Rewrite as Node** — if you'd rather not depend on Deno to run a plugin for
  an npm repo, port `main.ts` to a Node script reading stdin and writing stdout.
  The Op surfaces don't change.
- **Implement `release` properly** — swap the stub for `npm publish` (or
  `npm publish --access public`, a private registry, etc.).
- **Tune `finalize`** — `--package-lock-only` only rewrites the lockfile without
  fetching. Drop the flag if you want a full install, or remove `finalize`
  entirely if you don't track a lockfile in git.
- **Lock down permissions** — `deno run -A` grants everything for simplicity. A
  real plugin can narrow to `--allow-read --allow-write --allow-env --allow-run`
  (finalize shells out to `npm`).
