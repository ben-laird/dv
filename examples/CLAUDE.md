# examples/ — reference plugins

Loaded automatically when working inside `examples/`. These are **copyable
starting points** — not maintained dependencies and not first-party builtins.
That distinction is deliberate (see `.claude/CLAUDE.md` and `docs/design.md`):
promoting an example to a supported builtin is a separate, future decision.

## Rules

- Each plugin conforms to `docs/plugin-contract.md`: an executable speaking
  JSON-over-stdio, implementing the Ops it declares (`discover`,
  `read-version`, `write-version`, `update-dependency`, `release`).
- Responses must validate against `docs/schemas/plugin-responses.json`.
- Verify with `dv plugin verify <plugin>`; iterate on single Ops with
  `dv plugin invoke <plugin> <op>`.
- Keep them **minimal and readable** — they teach the contract. Clarity over
  cleverness; someone will copy one and adapt it.
- **No shared framework** between examples. Each stands alone so it can be
  lifted out wholesale. Duplication across examples is fine and expected.

## Planned set (v1)

- `plugins/cargo` — Rust crates (`Cargo.toml`).
- `plugins/npm` — npm packages (`package.json`).
- `plugins/pyproject` — Python (`pyproject.toml`).

Any language is allowed — a shell script is a perfectly good plugin. The set
above is just the most common ecosystems to seed.
