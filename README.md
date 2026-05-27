# dv

[![JSR](https://jsr.io/badges/@dv-cli/dv)](https://jsr.io/@dv-cli/dv)
[![JSR Score](https://jsr.io/badges/@dv-cli/dv/score)](https://jsr.io/@dv-cli/dv)
[![CI](https://github.com/ben-laird/dv/actions/workflows/dv-validate.yml/badge.svg)](https://github.com/ben-laird/dv/actions/workflows/dv-validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A language-agnostic, git-native changelog CLI for monorepos.

The name `dv` reads as the calculus notation for a tiny change in
v(ersion).

## What it is

`dv` manages `CHANGELOG.md` files across monorepos containing any mix of
languages and package ecosystems. Contributors file small markdown "record"
files alongside their PRs; `dv` aggregates them at release time into proper
CHANGELOG entries and version bumps.

Heavily inspired by [changesets](https://github.com/changesets/changesets),
but extends the model to any ecosystem via executable plugins.

**Works with any commit style.** `dv` reads Records, not commit messages
— so contributors write changelog intent for users, and commit messages
for reviewers, and neither has to compromise. Teams already on
[Conventional Commits](https://www.conventionalcommits.org) will get
bonus affordances (drafting Records from CC commits is on the roadmap),
but CC is never required.

## Quick example

A contributor adds a record alongside their PR:

```
$ dv add
? What kind of change? feat
? Which packages does this affect? core
? Describe the change (opens $EDITOR)
```

This writes `.dv/records/quiet-cats-sneeze.md`:

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

v1 ships. The whole v1 command surface from [specs/cli.md](specs/cli.md)
is implemented: `dv init`, `dv add`, `dv status`, `dv validate`,
`dv version`, `dv release`, `dv v1` (with catalog mode under
`--dry-run`), `dv rename`, `dv migrate config`, and
`dv plugin list|invoke|verify`.

Try it from the repo:

```sh
deno task install                                # adds `dv` to your PATH
dv status                                        # show pending bumps
dv add --type fix --packages @dv-cli/dv \
       --message "Demo record"                   # file a Record
dv validate                                      # lint records + config
dv version --dry-run                             # preview the version commit
dv version                                       # apply: bump, CHANGELOG, commit
```

Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md) for the PR flow,
how to file Records alongside your code change, and how to run the
test suite locally.

## Docs

Adoption-oriented docs (Tutorials, Concepts, Guides, Reference) live in
[apps/docs/](apps/docs/) and publish via VitePress. Start with the
[getting-started tutorial](apps/docs/content/getting-started.md).

The internal spec library at [specs/](specs/) is the design source of
truth — formal vocabulary, algebra, contracts. Useful if you're
contributing or reading the *why* behind a behavior.
