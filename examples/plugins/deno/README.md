# deno — example plugin

A reference plugin for Deno workspaces (packages with a `deno.json` carrying a
`name` and `version`). Copy it into your own repo and adapt — it is not a
maintained dependency (`examples/CLAUDE.md`).

## Wiring it up

`.changelog/config.yaml`:

```yaml
discovery:
  plugins:
    - match:
        - "apps/*"
        - "packages/*"
      use: ./examples/plugins/deno
```

## What it implements

- `discover` — walks the glob, returns every directory with a `deno.json` whose
  `name` field is set. The Package name is that field; the path is relative to
  `DV_REPO_ROOT`.
- `read-version` — reads `deno.json`'s `version` field. Manifests without a
  `version` field report `"0.0.0"` (the documented "no version yet" default;
  dv's algebra treats `0.0.0` as Unstable).
- `write-version` — sets `deno.json`'s `version` field to `DV_NEW_VERSION`.
  Preserves other fields and their insertion order; output is JSON with
  2-space indent and a trailing newline. Acceptable for the example because
  deno.json files in this repo don't carry root-level comments — a real-world
  plugin handling comment-bearing manifests would do surgical line edits.
- `update-dependency` — rewrites `imports[<dependency>]` in `deno.json` to
  point at `DV_NEW_VERSION`. Preserves any existing range prefix (`^`, `~`)
  and defaults to caret (`^`) for unrecognized forms — the modern Deno
  convention. Manifests with no `imports` map, or no entry for the named
  dependency, return `{ ok: true, changed: false }` — the documented no-op
  path of the cascade.

`release` lands in M5, alongside its subtool. The Plugin still conforms —
`dv plugin verify` only checks Ops the plugin actually declares.

## How

Directory-form plugin: each Op lives in its own executable named for the Op
(`./discover`, `./read-version`, `./write-version`, `./update-dependency`),
per `specs/plugin-contract.md` § Plugin shape. JSON-over-stdio. Set the
executable bit (`chmod +x`) when you copy a fresh Op file into place — dv
surfaces a clear PluginError if it isn't executable.
