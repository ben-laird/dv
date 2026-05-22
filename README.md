# dv

A language-agnostic, git-native changelog CLI for monorepos.

Project codename **Seshat** (the Egyptian goddess of writing and
record-keeping, who in mythology tracked the reigns of pharaohs and the
contents of libraries). The CLI itself is `dv` — read as *dv*, the calculus
notation for a tiny change in v(ersion).

## What it is

`dv` manages `CHANGELOG.md` files across monorepos containing any mix of
languages and package ecosystems. Contributors file small markdown "record"
files alongside their PRs; `dv` aggregates them at release time into proper
CHANGELOG entries and version bumps.

Heavily inspired by [changesets](https://github.com/changesets/changesets),
but extends the model to any ecosystem via executable plugins.

## Quick example

A contributor adds a record alongside their PR:

```
$ dv add
? What kind of change? feat
? Which packages does this affect? core
? Describe the change (opens $EDITOR)
```

This writes `.changelog/records/quiet-cats-sneeze.md`:

```markdown
---
type: feat
packages: [core]
---

Add support for OAuth flows.
```

When it's time to ship:

```
$ dv version    # bumps versions, updates CHANGELOGs, commits the result
$ dv release    # mints per-package git tags, fires release plugins
```

The two-phase flow is intentional — `version` produces an ordinary commit that
can be reviewed in a "Release PR" before tags get cut and publishes fire.

## Status

Milestones 1 and 2 ship: `dv init`, `dv status`, plugin-driven package
discovery, `dv add` (interactive + flag-driven), and `dv validate`. The
rest of v1 — version bumps, CHANGELOG rendering, tagging, and release —
is in flight per [specs/v1-scope.md](specs/v1-scope.md).

Try it from the repo:

```sh
deno task install                                # adds `dv` to your PATH
dv status                                        # discover packages
dv add --type fix --packages @seshat/dv \
       --message "Demo record"                   # file a Record
dv validate                                      # lint records + config
```

Contributing: see [CONVENTIONS.md](CONVENTIONS.md) for toolchain (Biome +
`deno lint`), test layout, and the Zod-generates-JSON-Schema flow.

## Docs

New here? Read the [walkthrough](specs/walkthrough.md) — `dv` end to end on a
sample monorepo — then dip into the rest as needed.

**Concepts**
- [Ubiquitous language](specs/language.md) — the canonical vocabulary and the
  algebra of the domain; the doc every other doc defers to
- [Design overview and rationale](specs/design.md) — architectural decisions
  and the *why* behind each

**Reference**
- [CLI reference](specs/cli.md) — every command, flag, and example
- [Record file format](specs/record-format.md) — the file users write
- [Config file format](specs/config-format.md) — `.changelog/config.yaml`
- [Plugin contract](specs/plugin-contract.md) — the extension surface
- [Schemas](specs/schemas/) — versioned config, plugin-response, and Plan contracts

**Planning**
- [v1 scope and roadmap](specs/v1-scope.md) — what ships, what's deferred
