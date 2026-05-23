# Design

This document captures the architectural decisions for `dv` and the
reasoning behind each. It is the source of truth for *why* the project is
shaped the way it is. Implementation details may evolve; the decisions here
should not, without explicit discussion.

## Vision

Make changesets-style change tracking available to any repository, regardless
of language or ecosystem, while staying lightweight, git-native, and free of
external services.

## Reference point: changesets

[changesets](https://github.com/changesets/changesets) nails a few things
worth preserving:

- **Pending changes as committable markdown files.** Reviewable in PRs,
  trivially mergeable, no external state.
- **Frictionless `add` flow.** Filing a change is a small interactive prompt.
- **One command turns N pending entries into proper version bumps and
  CHANGELOG entries.**

What makes changesets JS-locked:

- Reads/writes `package.json` for version + workspace dep graph
- npm-flavored release pipeline
- Node-only plugin model

`dv` keeps the file-based workflow and replaces the JS-specific bits with
a plugin contract.

## Architectural decisions

### Composable primitive, automation-friendly by default

`dv` follows Unix philosophy: do one job well, expose stable interfaces,
and let other tools compose with it. The job is "manage records and
releases for a monorepo." Anything beyond that — drafting records from
diffs, summarizing release notes, posting to chat, generating roadmaps
from issue trackers, embedding into CI dashboards — belongs in **separate
tools that call `dv`**, not in `dv` itself.

This explicitly includes AI features. `dv` will never embed an LLM, ship
with API key flows, or include "smart" suggestions for bump types or
record messages. The strict Record-type → SemVer mapping exists
precisely so that bump decisions stay with humans (or with tools the
user explicitly chose to install); embedding AI assistance would
undermine the deterministic, reviewable, git-native character of the
tool.

**Automation-friendly, not agent-friendly.** A core principle is that the
same affordances that make `dv` drivable by an AI agent — complete
non-interactive flag coverage, machine-readable output, stable exit
codes — also make it drivable by a 50-line bash script, a GitHub Actions
workflow, or a student writing their first Makefile. There is no
privileged tier of automator. A solo developer on a free account has
exactly the same automation surface as an enterprise with a fleet of
agents. This is **Unix-style egalitarianism**, and it's load-bearing: it
prevents the design from drifting toward features that only pay off when
you can afford to pay for the integration.

The v1 commitments that flow from this:

- **Complete non-interactive flag coverage.** Every interactive prompt
  has a `--flag` equivalent. Nothing requires sitting in front of the
  terminal.
- **`--json` output mode** on read commands (`status`, `validate`).
  Stable, documented schema, versioned with the tool.
- **Structured error codes** in JSON mode (`{"error": "dirty-tree"}`,
  `{"error": "unknown-package"}`) alongside human-readable messages, so
  callers can branch on specific failures.
- **Idempotent reads, predictable writes.** `dv version` with no pending
  records is a no-op, not an error. `dv release` with no new tags to
  mint is the same.
- **Standard exit codes.** `0` for success, non-zero for documented
  failure modes.

Companion tools that could live in separate projects (and likely should):

- An LLM-driven record drafter that reads PR diffs and shells out to
  `dv add` with proposed flags. Opt-in, separate install.
- An MCP server wrapping `dv`'s commands as agent tools.
- A GitHub Action maintaining a Release PR using `dv version` output.
- A web dashboard aggregating `dv status --json` across repos.

None of these belong in `dv` core. The boundary is firm and load-bearing
because it's what makes the layered architecture possible.

### Monorepo-first, git-coupled

`dv` assumes:

1. The repo contains one or more independently-versioned packages.
2. The repo is managed with git.

A single-package repo is just the degenerate case of a monorepo with one
package. Other VCSes are out of scope; coupling to git keeps the surface
small (atomic commits, tags, dirty-tree checks) and matches where the
overwhelming majority of users live.

### Language-agnostic via executable plugins

A plugin is **any executable** the OS can run. Shebang lines dispatch the
interpreter; a plugin can be a bash script, a Python file, a compiled Rust
binary, or a future SDK-built artifact. `dv` communicates with plugins via
a documented JSON-over-stdio contract (see `plugin-contract.md`).

Rationale: forces zero language-coupling. The MVP plugin author writes a
shell script; the eventually-shipped first-party plugins (Cargo, npm,
pyproject) are the same shape, just better-implemented.

Future extensions to plugin distribution:

- **SDKs** for popular languages (TS, Rust, Python) — sugar over the same
  JSON contract.
- **YAML inline plugins** — declarative "just do this" config for simple
  find/replace cases. Lowered to the same executable contract internally.

These are layered conveniences, not parallel mechanisms.

#### Plugin developer experience

Because v1 ships **no first-party builtins** (those are deferred), every
plugin in v1 is a hand-written executable. That makes plugin DX
load-bearing rather than optional — if authoring a plugin is painful,
`dv` is unusable in practice. v1 therefore includes:

- **`dv plugin invoke`** — run a single op with controlled inputs and see
  the full protocol exchange. Eliminates the need to stand up a whole repo
  to test one op.
- **`dv plugin verify`** — automated conformance smoke test, checking each
  op against a **versioned per-op response JSON schema**. (Formalizing
  those schemas is the discipline that makes the contract machine-checkable.)
- **`--debug` tracing** — log every plugin invocation during real runs.
- **Copyable example plugins** (Cargo, npm, pyproject) — *reference
  implementations to adapt, not maintained dependencies*. They lower the
  activation barrier at near-zero cost while keeping the deferral of true
  first-party builtins a conscious, separate decision. Promoting an example
  to a supported builtin is a deliberate future step, not a quiet drift.

`dv plugin new` (scaffolding) was considered for v1 and deferred — the
example plugins cover the "where do I start" need for now.

### Implementation language

v1 is written in **TypeScript on Deno**. Rust is a candidate for a future
rewrite if `dv` stabilizes enough to earn the polish.

Rationale:

- `dv` is primarily an orchestrator: it parses YAML/Markdown, manipulates
  files, spawns subprocesses (plugins), and shells out to git. The hot
  path is syscall/IO-bound, not CPU-bound. Both languages handle this
  well, so the choice turns on iteration speed and ergonomics.
- Deno's stdlib ships YAML, semver, glob, path, and TOML parsers out of
  the box. Subprocess management via `Deno.Command` is lower-friction
  than Rust's `std::process::Command` (and significantly less so than
  `tokio::process`).
- During the exploratory phase of v1, iteration speed matters more than
  cold-start latency or binary size. Deno's edit-run-test loop is in
  seconds; Rust forces more decisions earlier (ownership patterns, error
  type design, async runtime choice), and those decisions are sticky.
- The plugin contract is language-agnostic JSON-over-stdio, so the host
  language is **replaceable without breaking any plugin**. This makes
  the decision reversible at low cost.

A Rust rewrite earns consideration when:

- The CLI is invoked frequently enough that 50–100 ms cold start (Deno)
  vs ~10 ms (Rust) becomes a felt cost.
- Distribution friction matters — `deno compile` outputs ~80–100 MB
  binaries; Rust produces a few-MB static binary.
- The design has stabilized enough that the cost of re-litigating it
  against the borrow checker outweighs the discovery-phase tax of doing
  it in Rust upfront.

Until then, TypeScript on Deno.

### Capability decomposition

`dv` is built as a set of independent capability modules ("subtools"),
with CLI commands as thin orchestration layers over them. This mirrors
Biome's decomposition into formatter / linter / analyzer / assist —
independent capabilities that commands compose.

The subtools:

- **discovery** — enumerate packages and resolve which plugin manages each.
- **records** — author, parse, validate, and consume Records.
- **versioning** — compute version bumps from Records and apply them,
  including constraint cascade.
- **changelog** — render terse CHANGELOG entries from consumed Records
  (Keep a Changelog format: single-line bullets).
- **history** — optional long-form HISTORY.md companion that carries
  each Record's full body prose under per-version h3 subsections.
  Opt-in via `history.enabled` (see `config-format.md` § history).
  Same per-Package model as changelog; complementary, not exclusive.
- **tagging** — mint git tags.
- **publishing** — invoke release plugins.

Commands are orchestrations:

- `dv add` → discovery + records (create)
- `dv status` → discovery + records (read) + versioning (preview)
- `dv validate` → discovery + records (validate)
- `dv version` → discovery + records (consume) + versioning + changelog
  (+ history when enabled) + commit
- `dv release` → discovery + tagging + publishing + push

Git operations (stage, commit, push, tag, clean-tree checks) are the
**substrate** every subtool persists through, not a capability of their
own. They get a dedicated `git` config section rather than being
scattered across subtools, because some git operations are inherently
cross-subtool: the commit `dv version` produces bundles manifest changes
(versioning), CHANGELOG edits (changelog), HISTORY edits (history, when
enabled), and deleted Record files (records subtool) into a single commit.

Benefits:

- Each subtool is independently testable with a clear interface.
- The config mirrors the code: each subtool with user-facing options
  owns a top-level config section. (`versioning` has no config section
  in v1 because its policies are locked, but it's still a code module.)
- New commands are new orchestrations of existing subtools, not new
  monolithic code paths.

Why this and not the semantic-release model (a single linear pipeline of
lifecycle steps): `dv` has multiple distinct commands that are different
orchestrations of the shared subtools, not one pipeline. The plugin
contract *is* lifecycle-shaped (see `plugin-contract.md`), but the tool
itself is a set of composable capabilities.

### Config format

Config is **YAML, always**. No TypeScript, no JSON, no JSON-with-comments
alternatives. `.dv/config.yaml` is the canonical and only supported
format.

Rationale:

- Matches the broader Rust-ecosystem norm (Cargo TOML, Biome JSON,
  Turborepo JSON). Keeps the door open to a future Rust rewrite without
  any portability cost — config evaluation never requires a runtime.
- Universally readable. No execution surface, no surprises, no
  language-dependent build step to evaluate config.
- `dv`'s config surface is small (plugin wiring plus a few defaults); the
  value of a programmable config language is correspondingly low.

What this forecloses, and the intentional trade-offs:

- **Inline plugins as TypeScript/JS functions.** Plugins must be
  executables, or eventually declarative YAML "inline plugins" (see the
  future-surface section of `plugin-contract.md`). The ergonomic loss
  for TypeScript-ecosystem users is real but intentional; the
  language-agnostic identity wins.
- **Dynamic config** (env-driven plugin lists, conditional defaults).
  Standard YAML primitives (anchors, references, optional env var
  interpolation as a future feature) cover the legitimate cases without
  needing Turing-completeness in config.

Nice-to-have post-v1: ship a JSON Schema for `.dv/config.yaml` so
editors give autocomplete and validation. That recovers the type-safety
ergonomics of a TS config without any of the runtime cost or portability
debt.

#### Structure

The config's *structure* is modeled on Biome's `biome.json`: top-level
sections, an `extends` mechanism for sharing config across repos, and an
`overrides` array for per-package customization with first-match-wins
semantics. The sections are organized by **subtool** (see Capability
decomposition above): `discovery`, `records`, `changelog`, `tagging`,
`publishing`, plus the `git` substrate section and a global `safety`
section. Commands have no config sections of their own — they're
orchestrations of subtools. Key conventions:

- **kebab-case keys** throughout (YAML idiom).
- **`discovery.plugins[].match` is the source of truth for package
  discovery.** No separate `files` block. Excluding a package = not
  matching it.
- **`extends` is top-level only.** Local paths in v1; registry references
  later. No HTTPS URLs (supply-chain hazard).
- **Override-able sections**: `changelog`, `history`, `tagging`,
  `publishing`, and a package's plugin assignment — all per-package
  concerns. Not `git`, `safety`, `discovery` globals, `extends`, or
  `$schema`.

Lessons inherited from Biome's evolution: don't duplicate include/exclude
across domains (drove their config simplification), version the schema URL,
and reject unknown keys to catch typos.

See [`config-format.md`](config-format.md) for the full reference.

#### Config + flag parity for runtime behavior

A strong principle: **every config option that influences runtime
behavior has a corresponding command-line flag, and vice versa.** This
keeps `dv` controllable from a single command string for any caller
(scripts, CI, agents) without first writing a config file, and it lets
config settings act as defaults that any specific invocation can
override.

The principle has one explicit exception: **repo-definition config** is
config-only. These are settings that describe what the repo IS, not how
`dv` behaves on a given run: `$schema`, `extends`,
`discovery.plugins[].match`, `discovery.plugins[].use`, the structure of
`overrides`. Flag overrides for these make no coherent sense — you can't
usefully run `dv version` while pretending the plugin assignments are
different than they are.

Everything else — `git.*`, `records.*`, `changelog.*`, `tagging.*`,
`publishing.*`, `safety.*` — follows the parity rule. Setting it in config
establishes a default; passing the flag overrides for this invocation.
Boolean options accept both `--no-foo` (Unix convention) and `--foo=false`
(explicit-boolean form) for negation.

### Records over commit messages

`dv` borrows Conventional Commits' *vocabulary* for Record types, but
**never parses commit messages**. A Record's `type` field is constrained
to the CC subset `{feat, fix, feat!, fix!}` (see Algebra in
`specs/language.md`), and the mapping to SemVer is fixed:

- `feat` → minor bump
- `fix` → patch bump
- `feat!`, `fix!` → major bump (post-1.0; capped to minor pre-1.0)

This is the entire decision surface for bump levels. The vocabulary is
strict; how contributors *write commits* is entirely up to them.

**Why this matters.** The release-automation space currently forces a
choice:

- CC-required tools (semantic-release, release-please) derive bumps and
  changelogs from commit messages. Great leverage for teams already on
  CC; locked door for everyone else.
- CC-agnostic tools (Changesets) decouple changelog intent from commits.
  Inclusive, but CC users get no extra leverage from their existing
  discipline.

`dv` collapses that choice. Because Records are the authoritative
artifact, teams that don't use CC just write Records — same DX as
Changesets, no commit-format burden. Teams that *do* use CC get bonus
affordances (see roadmap below) that turn their existing discipline into
auto-drafted Records, while keeping Records reviewable on the PR.

This also resolves a real tension Changesets adopters have articulated:
commit messages and changelog notes serve two different audiences
(internal reviewers vs. published-artifact users), and forcing one
string to serve both is suboptimal. Records are for the user-facing
changelog; commits remain whatever shape the team prefers.

**v1 scope.** v1 implements only the inclusive half: contributors write
Records (via `dv add` or by hand), `dv` aggregates them. No commit
parsing, no CC enforcement, no CC linting.

**Roadmap (post-v1).** CC-accelerator affordances that read commits as
*input* only, never as the source of truth:

- `dv record from-commit <sha>` — draft a Record from a CC-formatted
  commit, opened for review before filing.
- `dv record from-range <range>` — draft Records across a commit range,
  for teams retrofitting `dv` onto existing CC history.
- An opt-in `--auto-from-commits` mode for `dv add` that prefills from
  the current branch's CC commits.

In every case the Record file is the source of truth — the commit is a
hint, the Record is the contract.

### Pre-1.0 policy: strict SemVer

For packages at `0.x.y`, all bumps stay in `0.x.y`-space. SemVer's strict
reading treats pre-1.0 as "anything may change," so we don't pretend there's
a stability contract.

The bump mapping pre-1.0 (major version pinned at 0):

- `fix` → patch (`0.4.1 → 0.4.2`)
- `feat` → minor (`0.4.1 → 0.5.0`)
- `feat!` / `fix!` (breaking) → **minor** (`0.4.1 → 0.5.0`)

Breaking changes bump *minor* pre-1.0, not major — there's no stability
contract to break yet, so a breaking change isn't the major event it
becomes post-1.0. This means `feat` and a breaking change produce the
same bump (minor) while a package is pre-1.0; the distinction only starts
to matter at 1.0+. This is the deliberate reading of "0.x is the wild
west" and is distinct from the 0ver convention (which would make `feat`
a patch).

Post-1.0, the standard mapping applies: `fix` → patch, `feat` → minor,
breaking → major.

#### The 1.0 transition: `dv v1`

Nothing auto-promotes a package to 1.0.0. Under the pre-1.0 mapping above,
no record type produces a major bump while a package is at `0.x` — so
reaching 1.0 is necessarily a deliberate human act. Rather than leave that
to hand-editing a manifest, `dv` provides a dedicated command:

**`dv v1 <package>`** sets a pre-1.0 package to `1.0.0`. It is a
phase-one operation (like `dv version`): it consumes pending records
into the `1.0.0` CHANGELOG entry, sets the version, and commits. It does
not tag or publish — `dv release` does that, keeping the two-phase model
intact.

- **Scoped to the 0.x → 1.0.0 transition only.** Errors if the package is
  already `≥ 1.0`. Post-1.0 major bumps are routine (driven by `feat!`
  records) and need no ceremony; the 0→1 commitment is philosophically
  unique and is the only milestone `dv v1` handles.
- **Gated.** Confirmation before proceeding, given the irreversibility of
  a stability commitment. `--yes` skips for non-TTY.
- **Celebrated.** `dv release` detects the first `1.0.0` tag (0.x → 1.0.0
  transition) and marks the occasion. `dv v1` itself acknowledges the
  staged commitment.

This also gives the gate a real job beyond ceremony: it fills the genuine
gap that no record type can produce a 1.0.0, while being more
discoverable, validated, and consistent than manual manifest editing.

### Only bump-producing types accepted as records

The Record-type vocabulary is `{feat, fix, feat!, fix!}` and nothing else.
This is a subset of Conventional Commits' broader type list (`chore`,
`docs`, `refactor`, `test`, `ci`, `build`, `perf`, `style`, `revert`), but
the relationship is incidental: `dv` doesn't ship the CC universe with
some types disabled — it defines its own small vocabulary, deliberately
chosen to match CC's bump-producing subset for familiarity.

Rationale: CHANGELOG.md is for users of the published artifact. If the
change doesn't affect them, it doesn't belong. `git log` is the place for
internal churn.

This can be relaxed later (e.g., add an opt-in "include internal changes"
mode) without restructuring anything.

### Per-package CHANGELOG.md

Each package gets its own `CHANGELOG.md` at its package root. This matches
how registries (npm, crates.io, PyPI) surface changelogs and keeps each
package's history self-contained.

CHANGELOG.md stays terse per Keep a Changelog conventions — single-line
bullets, action verbs, no prose paragraphs. The Record body's first
`# Headline` line becomes the bullet text; the rest of the body is not
rendered to CHANGELOG.

No aggregate root-level CHANGELOG in v1. Could be added later as an opt-in.

### Per-package HISTORY.md (opt-in)

For long-form release notes, dv writes an optional companion `HISTORY.md`
alongside each `CHANGELOG.md`. HISTORY carries each Record's full body
prose under `### Headline` subsections, grouped by version. Same per-Package
model as CHANGELOG; complementary, not exclusive.

Opt-in via `history.enabled: true` in `.dv/config.yaml`. Defaults
to off so existing dv repos see no behavior change. See
`config-format.md` § history.

Rationale: KaC bullets answer "what shipped" terse and scannable; HISTORY
answers "why these decisions" with the full prose authors wrote on the
Record at PR time. Agents grounding summaries in repo state benefit from
having the narrative without dv embedding any LLM features itself
(design.md § Composable primitive).

### Per-package git tags

Tags use the format `{package}@{version}` by default (e.g., `core@1.2.3`).
Configurable via `defaults.tag_format` in the config file. Format mirrors
the changesets/lerna convention — readable, sortable, monorepo-safe.

### Two-phase release

The release lifecycle is split into two commands:

1. **`dv version`** consumes all pending records:
    - bumps versions in package manifests (via the appropriate plugin)
    - updates each affected package's `CHANGELOG.md`
    - updates dependency constraints in dependent manifests (see below)
    - deletes the consumed record files
    - stages a commit

2. **`dv release`** acts on the now-current state of the repo:
    - mints per-package git tags
    - fires the release plugin for each bumped package

The split exists so the `version` commit can go through normal PR review
before any tags or publishes happen. The "Release PR" pattern (a long-lived
PR that gets recreated/updated by automation, merged when humans approve) is
the intended workflow on shared codebases.

#### Git interaction: commits and pushes

How interventionist `dv` is with git is configurable, with conservative
defaults:

- **`dv version` auto-commits by default** (`git.auto-commit`, default
  true). The commit is the reviewable artifact at the heart of the
  Release PR pattern, so producing it automatically — with a consistent,
  templated message (CC-shaped by default, since `dv` emits it and that
  costs nothing) — keeps that workflow smooth. This is a one-way emission
  convention, not a contributor requirement: `dv` writes a CC-shaped
  commit, but never reads contributor commits. Teams that prefer to
  compose their own commits set `auto-commit: false` (or pass
  `--no-commit`) and `dv version` stages the changes instead.
- **`dv version` does not push.** The commit lives on the current branch;
  pushing the branch is part of the user's PR workflow, not `dv`'s
  concern.
- **`dv release` does not push tags by default** (`git.auto-push`,
  default false). Pushing tags is the irreversible moment in the
  pipeline, so it's opt-in. CI workflows commonly want to control the
  push themselves (e.g., push only after all packages' release plugins
  succeed). Solo developers add one `git push --tags` afterward.
- **When push is enabled, `publish-then-push` is the default sequence**
  (`git.push-sequence`). Tags are minted locally, release plugins
  run, and only then are tags pushed — so a plugin failure leaves the
  remote untouched and the operation retryable. The alternative,
  `push-then-publish`, treats the pushed tag as the source of truth and
  relies on plugin idempotency.

All four are runtime-behavior settings and therefore follow the config +
flag parity rule. See `config-format.md` for the option reference.

Commits and tags honor git's own signing config by default (`git.sign:
auto`), since `dv` creates them via git's machinery — so `commit.gpgsign`
/ `tag.gpgsign` / `user.signingkey` just work. `git.sign: true|false`
forces or disables signing for a repo regardless of the contributor's
global config.

#### Release detection: git tags are the state

`dv release` is stateless. There is no `.dv-state` file tracking what's
been released. Instead, **git tags are the state**: a package needs
releasing if and only if its current version has no matching git tag.

`dv release` enumerates packages (discovery), reads each current version,
computes the tag it would carry (`tagging.format`), and checks whether
that tag exists. Missing tag → mint it and run the publish plugin.
Existing tag → already shipped, skip.

This is elegant for a git-coupled tool — the state lives where it
naturally belongs, survives any workflow, and needs no separate
bookkeeping. Consequences, all intentional:

- **Manual bumps are picked up.** A version hand-edited outside
  `dv version` (e.g. directly to a manifest) will be released by
  `dv release`, because `dv` only cares whether the current version has
  a tag, not how it got there. This makes `dv` robust to mixed
  workflows rather than demanding everything go through `dv version`.
- **First release.** A package with no tags has its current version
  released as an initial release; the "from" version is empty and the
  CHANGELOG/preview render it accordingly.
- **1.0 stabilization needs no special mechanic.** However a version
  reaches `1.0.0` (via `dv v1` or otherwise), `dv release` tags it on
  the next run. `dv v1` exists for the *gate and ceremony*, not because
  the release mechanic requires it.
- **Failed-release recovery.** If a tag exists but the publish plugin
  failed (e.g. the registry was down), `dv` considers the package
  released and skips it. `dv release --force` re-runs the publish step
  for already-tagged packages without re-minting tags, for retrying a
  failed publish.
- **Tag-format change caveat.** Changing `tagging.format` on an
  established repo means existing tags no longer match the computed
  pattern, and `dv` may treat packages as unreleased. Documented as
  "don't change tag format on a live repo without understanding the
  consequence."

### Dry-run and safety

Because `dv version` and `dv release` mutate manifests, CHANGELOG files,
and git state (and `release` may invoke plugins with publishing side
effects), both support dry-run mode as first-class behavior.

**Guarantees.** `--dry-run` produces a complete preview with **zero side
effects**, including no invocations of write-side plugin operations
(`write-version`, `update-dependency`, `release`). Only the read-only
`discover` and `read-version` ops run, since they're needed to compute
the plan and are presumed pure.

The preview reflects what a real run would do at the moment of
invocation. The implementation pattern that earns this guarantee:
`version` and `release` both build an explicit **Plan** object first,
describing every operation that would happen, then either print it
(dry-run) or execute it (real run). Same plan-building code in both
paths, which forecloses the "dry-run says one thing, real run does
another" failure mode.

**Flag placement.** `--dry-run` is supported both per-command
(`dv version --dry-run`) and as a global flag (`dv --dry-run version`).
For commands that have no destructive side effects (`status`, `validate`,
`init`, `add`), the global form is a no-op with an informational message
on stderr — keeps scripts robust and CLIs consistent.

**Default-dry-run mode.** `safety.dry-run-by-default: true` in config
makes every destructive command default to `--dry-run` regardless of
whether the flag is passed. To execute for real in that mode, the user
passes `--no-dry-run` (or `--dry-run=false`). When this mode is active,
`dv` prints a prominent banner at the top of each invocation indicating
the configured source, so the user is never confused about whether
changes will land. Intended uses: onboarding (training wheels while a
team is adopting `dv`) and high-stakes repos that want explicit
"yes I mean it" consent on every release.

**Plugin handling in dry-run mode.** `dv` does not invoke write-side
plugin ops at all. Instead, the plan logs the invocation that would have
happened, including the exact environment variables and any JSON payload
that would have been passed via stdin. This is the only way to guarantee
zero side effects regardless of how plugins are implemented — adding a
`DV_DRY_RUN` signal would require every plugin author to handle it
correctly, which is an unreasonable burden and a footgun.

**Output.** Human-readable summary by default; `--json` emits the
structured plan for programmatic consumption. The human format lists
package bumps with from/to versions, CHANGELOG entries that would be
added, dependency constraint updates, record files that would be
consumed, the commit message that would be staged, tags that would be
minted, and full plugin invocations with their env-var payloads.

**Companion safeguards on `dv release`.** Because `release` is the most
destructive command:

- **Interactive confirmation by default.** In TTY contexts, `dv release`
  prints the same summary `--dry-run` would, then asks "Proceed? [y/N]"
  before doing anything. `--yes` (or `-y`) skips the prompt.
- **Non-TTY contexts require explicit `--yes`.** If stdin isn't a
  terminal (CI, piped scripts, agents) and `--yes` was not passed,
  `dv release` fails with a clear error. This catches the failure mode
  of "I accidentally automated a release without realizing."
- **Pre-flight validation.** Before any tag minting, `dv release`
  verifies: clean working tree (if `git.require-clean-tree`), all
  required plugins reachable, no proposed tags already exist, all
  bumped packages still at expected versions. Failures abort with no
  state change.
- **Atomic where possible.** Operations within a single `release` are
  ordered and batched; partial failures leave the repo in a documented
  recoverable state.

`dv version` is less destructive (everything stays in git, no external
publishes) and does not prompt for confirmation by default — `--dry-run`
and pre-flight validation are its safety net.

### Status and output conventions

`dv status` is the reflexive "where am I" command, modeled on `git status`.
It shows the whole pipeline in two sections: **pending records** (what
`dv version` would do) and **awaiting release** (packages whose current
version has no tag — what `dv release` would do, derived directly from
tags-as-state). It is read-only and fails soft: a broken record
produces a "run `dv validate`" pointer rather than a crash.

```
$ dv status

Pending records — 3 records, 3 packages (run `dv version`):
  core   1.2.5 → 1.3.0   minor   3 changes
  cli    0.4.1 → 0.5.0   minor   1 change   (pre-1.0)
  web    2.0.0 → 2.1.0   minor   1 change
  + cli → core constraint updates to ^1.3.0

Awaiting release — 1 package (run `dv release`):
  utils  0.9.0   (no tag yet)
```

Architecturally, `dv status` is a read-only preview of `dv version`: both
run the same Plan computation in the versioning subtool. `status` renders
a summary; `dv version --dry-run` renders the full plan (CHANGELOG text,
commit message). Their `--json` output shares the Plan schema, so a tool
can consume either interchangeably.

Tool-wide output conventions (every command, not just status):

- **Human-readable by default; `--json` is the stable, versioned machine
  format.** Mirrors git's default-vs-`--porcelain` split.
- **Color is on for TTYs, off otherwise**, and always suppressed by the
  `NO_COLOR` env var or `--no-color`. Severity coloring (major / minor /
  patch) aids scanning.
- **Verbosity ladder**: a terse `-s` / `--short`, a default summary, and a
  `-v` / `--verbose` detail level, consistent across commands that support
  them.

### Constraint-only cascading

When package A bumps and package B depends on A, `dv` updates B's
dependency constraint on A in B's manifest, but does **not** bump B's own
version. If B itself should bump as a result, the author files a separate
record for B.

Rationale: the "right" version bump for a transitive dependency change is a
workflow judgment, not a mechanical one. Keeping manifests coherent is
mechanical (worth automating); deciding whether the consumer is now
breaking is editorial (worth keeping with humans). Full cascading can be
added later as an opt-in policy.

### Package renames and deletions

When `dv version` encounters a record referencing a package discovery
can no longer find, the package was either renamed or deleted. `dv` never
guesses which. Heuristic rename detection — git's content-similarity
approach — is unreliable for package identity (whose "identity" is fuzzy:
manifest name? directory? plugin-defined?) and dangerous here, because a
wrong guess corrupts release lineage, the one thing a changelog tool must
never do.

The reframe that makes this tractable: git uses heuristics because it
can't ask. `dv` operates at release time with a human or CI present who
knows whether a rename happened, so **explicit declaration** is both more
reliable and ergonomically fine. We trade git's "magic but fuzzy" for
"explicit but certain."

**The rename ledger.** `.dv/renames.yaml` is an append-only record
of lineage (`from`, `to`, and the version the rename took effect at). `dv`
resolves package references through it — a record referencing `core`
resolves to `engine`. The record file is never rewritten; it stays a
faithful record of what was authored, and the ledger maps at processing
time. A ledger entry turns an unresolved-reference error into clean resolution.

`dv rename <old> <new>` appends to the ledger and does nothing else. It
does not move directories, edit manifests, or rewrite records —
renaming the actual package is the user's job via their ecosystem's tools,
exactly as publishing belongs to plugins. The command and hand-editing the
ledger are the same operation; the command is sugar.

**History continuity.** The `CHANGELOG.md` file ports automatically when
the rename is a `git mv` — it travels with the directory, so the renamed
package's changelog already holds the prior history. The ledger supplies
the rest: it lets `dv` and external tooling stitch `core@*` and `engine@*`
tags into one logical timeline, and lets the changelog note lineage
("formerly `core`"). Old tags are never rewritten — they're immutable
history. Full timeline-reconstruction *display* is enabled by the ledger
but not built into v1; the data is there for tooling whenever wanted.

**Deletions.** A package genuinely removed (no rename recorded) is the
same unresolved-reference path: `dv version` halts with guidance. `dv version --prune`
drops unresolved references instead of halting — for the case where the
package was deliberately deleted and its pending records should go with
it. Halting is the safe default; pruning is the explicit opt-in.

### Three-word slug filenames

Record files are named after a random three-word slug (e.g.,
`quiet-cats-sneeze.md`). Collision-resistant, friendly, no merge conflicts
on filename. Matches changesets' convention because it works.

### Naming

The project carries two names that serve different roles:

The CLI command is **`dv`** — read as *dv*, the calculus notation for an
infinitesimal change in a variable. Here the variable is *version*: a
record is a small, well-defined change to a package's version, in the
same way that *dv* is the formal notion of a small change in math. Two
characters, no shell collisions, and the math reading is a quiet nod to
the δ-ε limit definition (where "small enough" first becomes formal) and
to incremental progress in general.

The project codename is **Seshat**, the Egyptian goddess of writing,
record-keeping, libraries, and historical chronicles. Mythologically she
recorded the reigns of pharaohs and the lifespans of mortals — an apt fit
for a tool whose job is recording what shipped (and eventually what's
planned). Seshat appears in the README intro, in agent-orientation docs,
and anywhere a sense of the project's identity matters more than the
command itself.

In running prose, `dv` (the official name) is preferred; "Seshat" is used
where it adds flavor or context.

## Deferred to v2: roadmaps

The same paradigm (tracked markdown files with YAML frontmatter, aggregated
into a generated document) extends naturally to roadmap entries — items
describing planned/future work. The release boundary becomes the temporal
seam: changelog covers what shipped, roadmap covers what's coming.

**Loose coupling** is the intended model: record and roadmap entries
have independent lifecycles, share infrastructure (frontmatter parsing,
aggregation engine), and may optionally cross-reference each other.

Deliberately deferred to v2 because:

- Roadmaps are far more opinion-laden than changelogs; getting the
  changelog half right and shipped first builds the foundation.
- It's the more speculative half of the project; build what's clearly
  useful first.

When this lands, the abstraction may earn a name like "ledger" with
changelog and roadmap as concrete instances. Do not introduce that
abstraction preemptively.

## Open questions

- **Snapshot / canary releases.** Out of v1. The hook will likely be a
  flag on `version` that produces non-tagged, non-cleaned-up release
  artifacts. Design when prioritized.
- **GitHub Actions companion.** changesets has a popular bot; `dv`
  should eventually have an equivalent. Not v1.
- **Pre-release tracks (alpha/beta/rc).** Out of v1. Design later.
