# @dv-cli/dv

[![JSR](https://jsr.io/badges/@dv-cli/dv)](https://jsr.io/@dv-cli/dv)
[![JSR Score](https://jsr.io/badges/@dv-cli/dv/score)](https://jsr.io/@dv-cli/dv)

A language-agnostic, git-native changelog CLI for monorepos. Records,
not commit messages.

## Install

```sh
deno install --global --allow-all --name dv jsr:@dv-cli/dv
```

## Use

```sh
dv init       # scaffold .dv/config.yaml
dv add        # author a Record
dv version    # bump versions + write CHANGELOGs
dv release    # tag + publish
```

## Docs

Full documentation — tutorials, concepts, guides, reference — lives
at [the dv docs site](https://github.com/ben-laird/dv/tree/main/apps/docs/content).
The five-minute tutorial is [getting-started](https://github.com/ben-laird/dv/blob/main/apps/docs/content/getting-started.md).

## Repository

This package is one of two published from
[ben-laird/dv](https://github.com/ben-laird/dv). The other,
[`@dv-cli/clipc`](https://jsr.io/@dv-cli/clipc), is the typed CLI
framework dv is built on.

MIT licensed.
