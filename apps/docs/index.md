---
layout: home
hero:
  name: dv
  text: A git-native changelog CLI for monorepos.
  tagline: Records, not commit messages. Strict SemVer. Plugins are executables. Dry-run first-class.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Why dv?
      link: /about/why-dv
features:
  - title: Records, not commit messages
    details: Contributors declare intent in a tracked file. No commit-message style enforcement; no CI fighting your team's PRs.
  - title: Plugins are executables
    details: Any language can speak the contract. JSON over stdio. No host-language lock-in and no first-party builtins to lock you in.
  - title: Dry-run is first-class
    details: Every destructive command has a full preview with zero side effects — the same plan-building code runs in dry-run and real-run paths.
---

<div style="max-width: 960px; margin: 4rem auto 0; padding: 0 24px;">

## In sixty seconds

```sh
# 1. Tell dv where your packages live
$ dv init

# 2. Author a Record when you make a change
$ dv add
? type: feat
? packages: @org/api
? notes: add /v2 endpoint
→ wrote .dv/records/sunset-cliff.md

# 3. Preview the release
$ dv version --dry-run
Plan (dry-run):
  @org/api 1.2.3 → 1.3.0 (minor)
       └ would update dependents: @org/client

# 4. Cut it for real
$ dv version
✓ versioned 1 package, committed a1b2c3d
  @org/api 1.2.3 → 1.3.0 (minor)
  ↳ updated 1 dependent constraint (@org/client)

# 5. Tag + publish
$ dv release
```

That's the whole loop. [Walk through it in detail →](/getting-started)

## What you get

- **Per-package CHANGELOG.md and per-package git tags** (`pkg-name@1.2.3`)
- **Constraint cascading** — when one package bumps, dependents' manifests update automatically
- **Two-phase release** — `dv version` lands a reviewable Release PR; `dv release` tags + publishes after merge
- **The 1.0 commitment is explicit** — `dv v1 @org/api` is the only way to cross from `0.x` to `1.0.0`, and it's celebrated

## Built for the way teams actually work

dv is designed around the observation that **commit-message parsing is a style fight, not a release strategy.** Contributors author Records — small files committed alongside their changes — and dv reads those, not the commit log. Teams that already write Conventional Commits keep doing so; teams that don't lose nothing.

The other half: **dv does one job well and exposes machine-readable interfaces** so any orchestration layer can drive it. Shell scripts, CI pipelines, AI agents — same automation surface, no privileged tier. No embedded AI, no hosted service, no account.

[Read the philosophy →](/about/why-dv)

</div>
