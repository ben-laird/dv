# v1 scope and roadmap

What `dv` v1 ships, what it explicitly does not, and a rough ordering for
implementation.

## In scope for v1

### CLI commands

The full command set, with synopsis, flags, and examples, lives in
[cli.md](cli.md). In scope for v1:

- **Authoring** — `dv init`, `dv add`, `dv validate`, `dv status`
- **Releasing** — `dv version`, `dv release`, `dv v1`
- **Maintenance** — `dv rename`, `dv plugin invoke`, `dv plugin verify`

Every command is fully flag-drivable (no prompts required), supports the
shared output conventions (`--json`, color, verbosity), and — where
destructive — supports `--dry-run`. See [cli.md](cli.md) for specifics.

### Plugin contract

- Executable plugins with JSON-over-stdio
- Operations: `discover`, `read-version`, `write-version`,
  `update-dependency`, `release`
- Env vars for scalars, stdin/stdout JSON for structured payloads
- **Versioned per-op response JSON schemas** so `dv plugin verify` (and
  authors' own CI) can machine-check conformance
- **Copyable example plugins** (Cargo, npm, pyproject) — reference
  implementations to adapt, not maintained dependencies
- `--debug` tracing logs full plugin I/O during real runs
- **Per-op timeouts**: fast ops bounded by `discovery.plugins[].timeout`
  (default 60s); `release` bounded by `publishing.timeout` (default none)

### Automation surface

Universal automation primitives — equally usable by shell scripts, CI
pipelines, AI agents, and anything else that can spawn a process. Not
agent-specific.

- **Full non-interactive flag coverage.** Every command runnable without
  prompts. Every interactive question has a flag equivalent.
- **`--json` flag** on read commands (`status`, `validate`) emitting a
  stable, documented, versioned schema. Also on `--dry-run` output of
  `version` and `release` to emit the structured Plan.
- **`--dry-run` on `version` and `release`** with zero side effects;
  also accepted as a global flag (no-op for commands without destructive
  ops). See `design.md` § Dry-run and safety.
- **`safety.dry-run-by-default` in config** flips destructive commands to
  default-dry-run mode for onboarding or high-stakes repos. Overridable
  per-invocation with `--no-dry-run`.
- **Structured error codes** in `--json` mode (e.g. `"error":
  "dirty-tree"`, `"error": "unknown-package"`) alongside human messages.
- **Idempotency** where it makes sense: no-op invocations are not errors.
- **Standard exit codes**: `0` success, non-zero with documented meanings.

### File formats

- Record format (frontmatter + markdown body)
- Config format (`.changelog/config.yaml`)
- Per-package `CHANGELOG.md` in Keep a Changelog style
- Per-package git tags as `{package}@{version}` (configurable)

### Behavior

- Strict CC + SemVer mapping; only `feat`, `fix`, breaking variants accepted
- Pre-1.0 strict semver: bumps stay in 0.x.y, breaking changes bump minor
  (capped from major), same as `feat`
- Constraint-only cascading (dependents' manifests updated; versions are not)
- Two-phase release lifecycle
- Commits and tags honor git's signing config by default (`git.sign: auto`)

## Deferred to later

Not v1, but the architecture leaves room for each:

- **Roadmap entries** — same paradigm, separate lifecycle (see `design.md`).
- **First-party plugins** — Cargo, npm, pyproject.toml, Maven, Go,
  promoted from the copyable example plugins with a maintenance
  commitment. v1 ships hand-written + example plugins only.
- **`dv plugin new`** — scaffolding command. Considered for v1, deferred;
  example plugins cover the "where do I start" need.
- **SDKs** — TypeScript, Rust, Python convenience layers over the JSON
  contract.
- **YAML inline plugins** — declarative shorthand for simple cases.
- **Snapshot / canary releases** — non-tagged, ephemeral release artifacts.
- **Pre-release tracks** — alpha/beta/rc handling.
- **Aggregate root CHANGELOG.md** — opt-in, "what shipped across the repo."
- **Full cascading bumps** — opt-in policy for auto-bumping dependents.
- **Inclusion of non-bump CC types in CHANGELOG** — opt-in "include
  refactors/docs" mode.
- **GitHub Actions companion** — bot/action that maintains a Release PR.

## Non-goals (probably forever)

- Replacing publish mechanisms (`npm publish`, `cargo publish`, etc.). Those
  belong inside release plugins.
- Supporting VCSes other than git.
- Imposing workflow opinions beyond CC + SemVer.
- Hosted services, SaaS, accounts.
- **Embedded AI features** — no LLM calls in `dv` itself, no API key
  flows, no "smart" suggestions. AI-driven tools that call `dv` are
  welcome and encouraged as separate projects; they do not belong in
  core. See `design.md` § Composable primitive for the principle.
- **Integrations with external services** (Slack, GitHub releases, chat
  notifications). These live in release plugins or companion tools.

## Suggested implementation order

A rough sequence that produces working subsets at each step. Each milestone
is independently dogfoodable.

1. **Skeleton + config + discover.** `dv init`, parse `config.yaml`,
   run `discover` against configured plugin globs, list discovered packages
   via `dv status`.
2. **Record add / validate.** `dv add` (interactive + flag modes),
   `dv validate`. Files are written but nothing acts on them yet.
3. **Version phase.** `dv version`: read versions, compute bumps,
   write new versions, update CHANGELOGs, delete records, stage a commit.
   No cascading yet.
4. **Constraint cascading.** Wire in `update-dependency` calls during
   version phase.
5. **Release phase.** `dv release`: tag minting, release-plugin
   dispatch.
6. **Polish.** Better errors, dry-run mode, cwd-aware `add`, pre-commit
   hook example.

Each step is a usable tool for *someone*. Step 3 already lets a solo dev
manage a single-package repo end-to-end (skipping tags and publish).

## What "done" looks like for v1

A user can:

1. Drop `dv` into an existing monorepo of any languages.
2. Write a small shell-script plugin per ecosystem (or use whatever
   built-ins ship by then).
3. Have contributors file records via `dv add`.
4. Get a clean Release PR via `dv version`.
5. Cut tags and trigger publishes via `dv release`.

With CC + SemVer adherence enforced and per-package CHANGELOGs maintained.
