# @dv-cli/dv

[![JSR](https://jsr.io/badges/@dv-cli/dv)](https://jsr.io/@dv-cli/dv)
[![JSR Score](https://jsr.io/badges/@dv-cli/dv/score)](https://jsr.io/@dv-cli/dv)

A language-agnostic, git-native changelog and release CLI for monorepos.
Versioning is driven by **Records** — small files declaring intent — not by
parsing commit messages. Strict SemVer, per-package CHANGELOGs and git tags,
and plugins that teach `dv` about any ecosystem.

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

## How it works

- **Records, not commit messages.** A Record is a markdown file in
  `.dv/records/` declaring a single user-facing change: its `type` (`feat`,
  `fix`, `feat!`, `fix!`), the packages it touches, and a note. `dv` never
  parses git history, so contributors write commits however they like; the
  Record is the authoritative declaration of intent. Teams already on
  Conventional Commits get bonus affordances, but CC is an accelerator, never a
  gate.
- **Plugins are executables.** `dv` itself is ecosystem-agnostic. A plugin —
  any program speaking JSON over stdio — teaches it how to discover packages,
  read and write versions, and rewrite dependency constraints for a given
  ecosystem (Cargo, npm, Deno, …). No host-language lock-in; copyable example
  plugins ship as references to adapt.
- **Two-phase release.** `dv version` computes the bumps from pending Records,
  writes per-package CHANGELOGs, and stages one reviewable commit. `dv release`
  then mints per-package git tags and runs publish hooks. Release state lives in
  git tags alone — a package needs releasing iff its current version has no
  matching tag — so there is no state file to drift.
- **Dry-run is first-class.** `dv version --dry-run` and `dv release --dry-run`
  produce a complete preview with zero side effects, including no write-side
  plugin calls. The same plan-building code runs in dry-run and real paths.

## Library API

`dv` ships its command runners as an importable library so other Deno programs
can drive it in-process instead of shelling out:

```typescript
import { runStatus, runVersion } from "@dv-cli/dv";
```

The surface mirrors the CLI — `runStatus`, `runVersion`, `runRelease`,
`runValidate`, `runV1`, `runInit`, `runAdd`, `runRename`, the `runPlugin*`
family, and `runMigrateConfig` — each returning a typed result envelope (the
same shape the CLI emits under `--json`). Shell scripts and agent fleets get the
identical machine-readable contract: non-interactive flags, versioned `--json`
output, and stable exit codes, with no privileged tier.

## Docs

Full documentation — tutorials, concepts, guides, and per-command reference —
lives at
[the dv docs site](https://github.com/ben-laird/dv/tree/main/apps/docs/content).
The five-minute tutorial is
[getting-started](https://github.com/ben-laird/dv/blob/main/apps/docs/content/getting-started.md).

## Repository

This package is one of two published from
[ben-laird/dv](https://github.com/ben-laird/dv). The other,
[`@dv-cli/clipc`](https://jsr.io/@dv-cli/clipc), is the typed CLI framework dv
is built on.

MIT licensed.
