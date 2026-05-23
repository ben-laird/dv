# dv (Seshat) — agent orientation

This file orients Claude Code (or any AI coding agent) picking up this project.
Read it first.

## What this is

`dv` (codename **Seshat**) is a language-agnostic, git-native changelog CLI
for monorepos. The CLI command is `dv`; the project codename is Seshat. As
of this writing it is **designed but unimplemented** — these docs describe
the target.

## Where to look

- `README.md` — public pitch and quick example
- `specs/design.md` — architectural decisions and the *why* behind each
- `specs/language.md` — **the ubiquitous language**: canonical terms + the
  domain algebra. When a term is in question, this doc wins. Read it first.
- `specs/walkthrough.md` — `dv` end to end on a sample monorepo; the fastest
  way to grok the pipeline
- `specs/cli.md` — per-command reference (synopsis, flags, examples)
- `specs/record-format.md` — the user-facing record file format
- `specs/config-format.md` — `.dv/config.yaml` reference
- `specs/plugin-contract.md` — extension surface (any executable can be a plugin)
- `specs/schemas/` — versioned JSON Schema drafts: config, plugin-responses, plan
- `specs/v1-scope.md` — what's in v1, what's deferred, in what order to build

## Working agreement

- **Read order.** `specs/language.md` first — its vocabulary and algebra are
  authoritative. Use its exact terms (Record, not "changeset"; Bump;
  Stability; Plan; Tag; Unresolved Reference). Then `specs/design.md` for the
  *why*, then the specific reference doc for the thing you're building.
- **Build order.** Follow `specs/v1-scope.md` § Suggested implementation
  order. Each milestone is independently dogfoodable; don't skip ahead.
- **The docs are the source of truth.** Every behavior is specified. If
  something you need isn't covered, that is a genuine gap — **surface it and
  ask**, don't invent the decision. Many choices here were made deliberately
  against plausible alternatives; silently reinventing them is a regression.
- **Keep docs and code in lockstep.** If a decision genuinely changes, update
  the relevant doc — and `language.md` / `specs/schemas/` if the vocabulary or
  contracts move — in the same change. Code that contradicts the docs is a
  bug in one of them.
- **The algebra is testable.** The laws in `language.md` (bump = join,
  idempotence, plan determinism, no Record produces 1.0.0) are property-test
  targets, not just prose.

## Strong opinions already locked in

These are not up for re-litigation without explicit conversation:

- **Monorepo-first.** Single-package repos work as a degenerate case.
- **Git-coupled.** The tool assumes a git repo and uses it directly.
- **Strict SemVer; CC-compatible Record vocabulary.** Records carry a
  `type` field drawn from a Conventional Commits subset (`feat`, `fix`,
  `feat!`, `fix!`) — that vocabulary is fixed. But `dv` **never parses
  commit messages**: Records are the authoritative declaration of intent,
  and contributors can write commits however they like. Teams already on
  CC get bonus affordances (planned: `dv record from-commit`, drafting
  Records from CC-formatted history); teams that aren't lose nothing.
  CC is an accelerator, not a gate. See `specs/design.md` § Records over
  commit messages.
- **Plugins are executables.** Shebang-routed; no host-language lock-in.
  v1 ships no first-party builtins, so plugin DX is load-bearing:
  `dv plugin invoke` (test one op), `dv plugin verify` (conformance vs
  versioned per-op schemas), `--debug` tracing, and **copyable example
  plugins** (Cargo, npm, pyproject) that are references to adapt, not
  maintained dependencies. Scaffolding (`dv plugin new`) is deferred.
- **Two-phase release.** `dv version` (bumps + CHANGELOGs) then
  `dv release` (tags + publish hooks).
- **Git tags are the release state.** `dv release` is stateless — a
  package needs releasing iff its current version has no matching git
  tag. No state file. Picks up manual bumps; needs no special mechanic
  for first-release or 1.0. `dv v1 <package>` is a gated, celebrated
  command for the 0.x → 1.0.0 stability commitment (the one milestone
  no record type can produce). See `specs/design.md`.
- **Renames are declared, never guessed.** Heuristic rename detection is
  avoided (dangerous for release lineage). An explicit append-only
  ledger (`.dv/renames.yaml`, writable via `dv rename`) resolves
  references and enables history stitching. Unresolved references (vanished
  package, no rename entry) halt `dv version`; `--prune` drops them.
  `dv rename` is bookkeeping-only — it never touches the actual package.
- **Per-package CHANGELOG.md and per-package git tags** (`pkg-name@1.2.3`).
- **Constraint-only cascading.** When a dep bumps, its consumers' manifests
  get the new constraint, but consumers themselves do not auto-bump.
- **Only bump-producing Record types are accepted.** Records carry one of
  `feat`, `fix`, `feat!`, `fix!`. Non-bump categories (`chore`, `docs`,
  `refactor`, etc.) are deliberately *not* a thing in `dv` — internal
  churn lives in git history, not CHANGELOG.
- **Config is YAML only.** No TypeScript, JSON, or other config formats. See
  `specs/design.md` § Config format for the trade-offs.
- **Capability decomposition.** `dv` is built as independent subtool
  modules (discovery, records, versioning, changelog, tagging,
  publishing) with commands as thin orchestrations over them. Config is
  organized by subtool, with a `git` substrate section for cross-cutting
  git operations. Git is a substrate, not a capability. `versioning` has
  no config section in v1 (its policies are locked) but is still a module.
  See `specs/design.md` § Capability decomposition.
- **Composable Unix primitive.** `dv` does one job well and exposes
  machine-readable interfaces so anything else can drive it. No embedded
  AI, no integrations with external services, no SaaS. AI-driven tooling
  that calls `dv` is welcome and belongs in **separate** projects. The
  automation surface (non-interactive flags, `--json` output, stable
  exit codes) is identical for shell scripts and agent fleets — no
  privileged tier.
- **Dry-run is first-class on `version` and `release`.** `--dry-run`
  produces a complete preview with **zero side effects**, including no
  write-side plugin invocations. Plan-then-execute architecture: same
  plan-building code runs in both dry-run and real-run paths.
  `dv release` prompts for confirmation by default in TTY contexts and
  requires explicit `--yes` in non-TTY contexts. `safety.dry-run-by-default`
  in config can flip the whole tool into default-dry-run mode. See
  `specs/design.md` § Dry-run and safety.
- **Config + flag parity for runtime behavior.** Every config option
  that influences how `dv` acts on a given run has a corresponding
  command-line flag, and vice versa. Exception: repo-definition config
  (`$schema`, `extends`, `plugins`, `overrides` structure) is config-only.
  Boolean flags accept both `--no-foo` and `--foo=false`.
- **Output conventions.** Human-readable by default; `--json` is the
  stable, versioned machine format (git's default-vs-`--porcelain`
  split). Color on for TTYs, suppressed by `NO_COLOR` / `--no-color`.
  `dv status` is a read-only preview of `dv version` and shares its Plan
  schema. See `specs/design.md` § Status and output conventions.

## What `dv` is *not*

- Not a replacement for `npm publish` / `cargo publish` / etc. Those happen
  inside release plugins.
- Not an opinionated workflow tool beyond SemVer + a small Record-type vocabulary.
- Not a roadmap tool *yet* — that's a deliberate v2 scope (see `specs/design.md`).

## Notes for implementation

- The CLI is written in **TypeScript on Deno**. A Rust rewrite is on the
  table only if/when `dv` stabilizes enough to earn the polish — see
  `specs/design.md` § Implementation language for the rationale and
  trigger conditions.
- The plugin contract is the most stable surface; design changes to it should
  be discussed before being made.
- When in doubt about a workflow opinion, **ask** rather than encode it.
