# apps/cli/ — implementation conventions

Loaded automatically when working inside `apps/cli/`. Assumes you've read
`.claude/CLAUDE.md` and `specs/language.md`.

This is the `dv` CLI: the primary workspace member. Source lives under
`apps/cli/src/`; the package's own `deno.json` declares its name, exports, and
tasks. The repo's shared imports, fmt, and lint live in the root `deno.json`.

## Architecture

`dv` is built as the subtool decomposition from `specs/design.md`. One module
per capability; commands compose them and hold no domain logic of their own.

- `src/subtools/plugin` — JSON-over-stdio runner + per-Op response schemas.
  Used by every subtool that talks to a plugin (discovery, versioning,
  later publishing).
- `src/subtools/discovery` — run discover plugins, resolve the Package set.
- `src/subtools/records` — author, parse, and validate Records.
- `src/subtools/renames` — load the rename ledger, build the reflexive-
  transitive closure resolver (Algebra §8).
- `src/subtools/versioning` — the **pure algebra** (`classify`, `apply`,
  `aggregateBumps`, `joinBumps`) plus `buildVersionPlan` and the
  per-Package `read-version` / `write-version` invokers. Algebra files
  do no IO.
- `src/subtools/changelog` — render Keep a Changelog sections from Records
  and splice them into per-Package CHANGELOG.md files.
- `src/subtools/git` — the shared substrate: clean-tree assertion, stage,
  commit. Git is not a capability of its own (specs/design.md).
- `src/subtools/tagging` — Tag formatting + git tag IO (M5).
- `src/subtools/publishing` — invoke the release plugin (M5).
- `src/cli/` — one thin orchestration per command (`init`, `add`, `status`,
  `validate`, `version`, `release`, `v1`, `rename`, `plugin …`).

## Invariants to preserve

- **Plan-then-execute.** Every destructive command computes a `Plan` (a pure
  function of repo state) and then executes it. `dv status`, `--dry-run`, and
  the real run share the _same_ plan-building code — they must not diverge
  (`specs/language.md` Algebra §7). The Plan serializes to
  `specs/schemas/plan.json`.
- **Keep the core algebra pure.** `classify` / `apply` / `aggregate` / bump-join
  touch no git, filesystem, or plugins. Push IO to the edges so the laws stay
  property-testable.
- **Release is stateless.** Never write a release-state file. A Package is
  released iff its current Version has a matching Tag (Algebra §4).
- **Plugins are a boundary.** All plugin interaction is JSON-over-stdio per
  `specs/plugin-contract.md`. Validate responses against
  `specs/schemas/plugin-responses.json`; honor the per-slot timeouts.
- **`--json` is a contract**, matching the committed schemas — never an ad-hoc
  shape.

## Toolchain

- TypeScript on Deno. Prefer the std modules wired in the root `deno.json`:
  `@std/semver` (Versions/Bumps), `@std/front-matter` (Records), `@std/yaml`
  (config), `@std/cli` (arg parsing), `@std/path`, `@std/fs`, `@std/assert`
  (tests).
- Model the domains from `language.md` as types — `Bump` as a 3-value union,
  `Stability`, `ChangeType` — so the compiler enforces the lexicon.
- **Zod** validates every contract boundary: `.changelog/config.yaml`, plugin
  stdio JSON, the Plan emitted by `--json`. Hand-rolled validation is a
  regression. JSON Schemas under `specs/schemas/` are **generated** from the
  Zod source via `deno task schemas:generate`; `deno task schemas:check`
  is the drift gate. Never hand-edit a generated JSON Schema.
- Each Zod schema file exports both a `raw…Schema` (pure shape, fed to
  `z.toJSONSchema()`) and a parser-shaped schema piped through a
  kebab→camel transform (used by loaders). Keep transforms out of the
  raw schema — `toJSONSchema` can't represent them.
- **Biome** (via `npm:@biomejs/biome`) is the formatter and _one of two_
  linters. Do not run `deno fmt` against TS — Biome owns formatting.
  But `deno lint` runs alongside Biome's linter and is required to
  pass: it catches Deno-specific rules (`no-window`,
  `no-sync-fn-in-async-fn`, etc.) Biome doesn't know about.
  `deno task lint` runs both.

See [`../../CONVENTIONS.md`](../../CONVENTIONS.md) for the cross-cutting
engineering grain (test naming, Given/When/Then, function-param objects,
descriptive variable names).

## Workflow

- Iterate quickly with `deno task install` — puts an in-tree `dv` shim
  on PATH so you can run it in your real terminal, see colors, and
  exercise prompts. Edits land on the next invocation.
- Run `deno task fmt`, `lint`, `check`, and `test` before calling
  anything done.
