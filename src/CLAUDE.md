# src/ — implementation conventions

Loaded automatically when working inside `src/`. Assumes you've read
`.claude/CLAUDE.md` and `docs/language.md`.

## Architecture

`dv` is built as the subtool decomposition from `docs/design.md`. One module
per capability; commands compose them and hold no domain logic of their own.

- `subtools/discovery` — run discover plugins, resolve the Package set.
- `subtools/changesets` — author, parse, and validate Records.
- `subtools/versioning` — the **pure algebra**: `classify`, `apply`,
  `aggregate`, bump-join (`docs/language.md` § Operations). No IO here.
- `subtools/changelog` — render CHANGELOG sections (Keep a Changelog).
- `subtools/tagging` — Tag formatting + git tag IO.
- `subtools/publishing` — invoke the release plugin.
- `cli/` — one thin orchestration per command (`init`, `add`, `status`,
  `validate`, `version`, `release`, `v1`, `rename`, `plugin …`).

## Invariants to preserve

- **Plan-then-execute.** Every destructive command computes a `Plan` (a pure
  function of repo state) and then executes it. `dv status`, `--dry-run`, and
  the real run share the *same* plan-building code — they must not diverge
  (`docs/language.md` Algebra §7). The Plan serializes to
  `docs/schemas/plan.json`.
- **Keep the core algebra pure.** `classify` / `apply` / `aggregate` /
  bump-join touch no git, filesystem, or plugins. Push IO to the edges so the
  laws stay property-testable.
- **Release is stateless.** Never write a release-state file. A Package is
  released iff its current Version has a matching Tag (Algebra §4).
- **Plugins are a boundary.** All plugin interaction is JSON-over-stdio per
  `docs/plugin-contract.md`. Validate responses against
  `docs/schemas/plugin-responses.json`; honor the per-slot timeouts.
- **`--json` is a contract**, matching the committed schemas — never an
  ad-hoc shape.

## Toolchain

- TypeScript on Deno. Prefer the std modules wired in `deno.json`:
  `@std/semver` (Versions/Bumps), `@std/front-matter` (Records),
  `@std/yaml` (config), `@std/cli` (arg parsing), `@std/path`, `@std/fs`.
- Model the domains from `language.md` as types — `Bump` as a 3-value union,
  `Stability`, `ChangeType` — so the compiler enforces the lexicon.
- Run `deno task fmt`, `lint`, `check`, and `test` before calling anything
  done.
