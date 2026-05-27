# examples/ — reference plugins

Loaded automatically when working inside `examples/`. These are **copyable
starting points** — not maintained dependencies and not first-party builtins.
That distinction is deliberate (see `.claude/CLAUDE.md` and `specs/design.md`):
promoting an example to a supported builtin is a separate, future decision.

## Rules

- Each plugin conforms to `specs/plugin-contract.md`: an executable speaking
  JSON-over-stdio, implementing the Ops it declares (`discover`,
  `read-version`, `write-version`, `update-dependency`, `release`).
- Responses must validate against `specs/schemas/plugin-responses.json`.
- Verify with `dv plugin verify <plugin>`; iterate on single Ops with
  `dv plugin invoke <plugin> <op>`.
- Keep them **minimal and readable** — they teach the contract. Clarity over
  cleverness; someone will copy one and adapt it.
- **No shared framework** between examples. Each stands alone so it can be
  lifted out wholesale. Duplication across examples is fine and expected.

## Ecosystem-plugin set

- `plugins/deno` — Deno workspaces (`deno.json`). Ships.
- `plugins/npm` — npm packages (`package.json`). Ships.
- `plugins/cargo` — Rust crates (`Cargo.toml`). Planned.
- `plugins/pyproject` — Python (`pyproject.toml`). Planned.

Any language is allowed — a shell script is a perfectly good plugin. The
set above is just the most common ecosystems to seed.

## Release-only plugins

A second category: plugins that don't read or write manifests, only
publish. They implement `info`, `discover` (typically returning an empty
list), `read-version` (typically returning `0.0.0`), and `release`.

- `plugins/github-releases` — creates a GitHub Release via `gh release
  create` after dv mints the tag. Wiring this in as a SECOND release
  channel alongside an ecosystem plugin (publish to JSR AND post a GH
  Release for the same package) requires a contract change we haven't
  made yet; see ROADMAP § "Opt into multi-channel publishing". For now
  the plugin exists as a reference + runs cleanly via `dv plugin
  invoke` / `verify`.
