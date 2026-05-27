# Contributing to dv

Thanks for considering a contribution. This page is the short version
for human contributors. If you're an AI coding agent picking up the
project, read [.claude/CLAUDE.md](.claude/CLAUDE.md) first — it has
the orientation context.

## Before you start

A few things worth knowing before you dive in:

- **Read [README.md](README.md)** for what dv does and the quick example.
- **`dv` is opinionated about one thing: SemVer.** We don't relitigate
  that or the [v1 scope](specs/v1-scope.md). New features that don't
  fit the scope go in [ROADMAP.md](ROADMAP.md) as deferrals with
  reasoning, not as PRs. If you're not sure where your idea falls,
  open a discussion or feature-request issue first.
- **The public API surface is small and stable.** Every CLI flag,
  every `--json` envelope, every error code is part of the contract.
  Breaking changes need a `feat!` / `fix!` Record (see below) and a
  conscious major-version bump.

## Setting up

`dv` is TypeScript on Deno. You need:

- **Deno v2.x** ([install](https://docs.deno.com/runtime/getting_started/installation/))
- **Git**
- Optionally: **Node.js + npm** if you're working on the example npm plugin

```sh
git clone https://github.com/benlaird0/dv && cd dv
deno task install          # adds an in-tree `dv` to your PATH
dv status                  # sanity-check the install
```

`deno task install` writes a launcher to `~/.deno/bin/dv` that points
at the live source — edits flow through immediately on the next
invocation, no rebuild needed.

## The PR flow

For any user-visible change (a new feature, a bug fix, a breaking
change):

1. **Open a PR with your code change.**
2. **Author a Record** alongside the code in the same PR:

   ```sh
   dv add --type feat --packages '@dv-cli/dv' \
          --notes "your one-line summary"
   ```

   This writes a small markdown file under `.dv/records/`. Commit it
   alongside your code. The Record is what dv aggregates into the
   CHANGELOG when the next release ships.

3. **Run the local gate:**

   ```sh
   deno task verify          # fmt + lint + check + test + schemas
   ```

   The CI workflow runs the same thing on every PR. Catching it
   locally first saves a round-trip.

For internal cleanup with no user-visible effect (test refactors,
internal type tightening, doc fixes), no Record is needed — the change
just doesn't show up in the CHANGELOG.

## What kind of Record?

dv's Record-type vocabulary is small on purpose:

| Type | Meaning |
|---|---|
| `feat` | New feature, minor bump |
| `fix` | Bug fix, patch bump |
| `feat!` | Breaking new feature, major bump (or capped minor pre-1.0) |
| `fix!` | Breaking bug fix, major bump (or capped minor pre-1.0) |

That's it. `chore`, `docs`, `refactor`, `style`, `perf` — none of
those exist as Records. If a change has no user-visible effect, it
doesn't get a Record; if it does have user-visible effect, one of
the four types above fits it.

## Daily tasks

The full list lives in [.claude/CONVENTIONS.md](.claude/CONVENTIONS.md).
The ones you'll use most:

| Task | What it does |
|---|---|
| `deno task dv -- <args>` | Run the in-tree `dv` CLI (one-off, without installing) |
| `deno task fmt` | Format with Biome |
| `deno task lint` | Biome lint + `deno lint` |
| `deno task check` | Type-check the entry points |
| `deno task test` | Full test suite (~300 tests, ~20s) |
| `deno task verify` | All of the above in sequence (the CI gate) |

## Where the docs live

- **[apps/docs/](apps/docs/)** — the published documentation site
  (VitePress). User-facing content: tutorials, concepts, how-to
  guides, reference. If your change affects user-visible behavior,
  the matching doc page probably needs updating too.
- **[specs/](specs/)** — internal design library. Contracts,
  vocabulary, algebra, decision rationale. Edit these if you're
  changing dv's *behavior* or *contract*. Don't edit them just to
  reword something — they're the team's source of truth, kept terse.
- **[.claude/CONVENTIONS.md](.claude/CONVENTIONS.md)** — engineering
  conventions (toolchain, test layout, the Zod → JSON Schema flow).
- **[ROADMAP.md](ROADMAP.md)** — what's deferred and why.

## Plugins

If you're contributing a plugin (a new ecosystem integration), the
relevant docs are:

- **[apps/docs/content/tutorials/write-a-plugin.md](apps/docs/content/tutorials/write-a-plugin.md)** —
  step-by-step plugin tutorial.
- **[specs/plugin-contract.md](specs/plugin-contract.md)** — the
  authoritative wire-format reference.
- **[examples/plugins/](examples/plugins/)** — the deno and npm
  example plugins are copyable starting points (per
  [examples/CLAUDE.md](examples/CLAUDE.md), they're not maintained
  dependencies). Fork them, adapt them, own them.

Plugins must pass `dv plugin verify <your-plugin>` before submission.
The CI workflow runs verify against every plugin in the repo on each
PR — so if your plugin is in the tree, it gets checked automatically.

## Questions

If something is unclear, the spec library is probably the right place
to look first. If it's *not* answered there, that's a real gap — open
an issue or PR.

Specifically:

- **For "should this be in v1?" questions** — see
  [specs/v1-scope.md](specs/v1-scope.md). Most "no" answers have
  rationale; deferral conversations start there.
- **For "why is dv shaped this way?" questions** — see
  [specs/design.md](specs/design.md). Most architectural decisions
  have a section explaining the alternative that was considered and
  why it lost.
- **For "what does this error mean?" questions** — see the
  [troubleshooting reference](apps/docs/content/reference/troubleshooting.md)
  on the published site. Every dv error code has an entry.
