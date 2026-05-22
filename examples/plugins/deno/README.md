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

Future Ops (`read-version`, `write-version`, `update-dependency`) land in later
milestones, alongside their respective subtools. The Plugin still conforms —
`dv plugin verify` only checks Ops the plugin actually declares.

## How

Directory-form plugin: each Op lives in its own executable named for the Op
(`./discover`, eventually `./read-version`, …), per `specs/plugin-contract.md` §
Plugin shape. JSON-over-stdio.
