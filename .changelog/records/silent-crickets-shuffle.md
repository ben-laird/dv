---
type: feat
packages:
  - '@seshat/dv'
---

Implement M2: `dv add`, `dv validate`, and the rename ledger

Builds out the authoring surface per specs/v1-scope.md § M2:

- `dv add` files a Record in `.changelog/records/`. Two paths share validation:
  flag-driven (`--type`, `--packages`, `--message`, optional `--links`/`--notes`)
  for CI and agents, and an interactive TTY flow that prompts for Change Type
  and packages and opens `$EDITOR` for the body.
- Slug generator picks three-word filenames (adjective-plural_noun-verb) with
  ~884k combinations and retries on collision.
- `dv validate` lints every record file and the config against their Zod
  schemas. `--json` output is the stable machine surface.
- Rename ledger (`.changelog/renames.yaml`) resolves package references via
  reflexive-transitive closure per language.md Algebra §8 — unresolved
  references stop `dv version`; `--prune` will drop them once M3 lands.
- Records subtool renamed from `changesets` to align with the ubiquitous
  language. The file on disk is still a Record; the subtool is `records`.
- Dev shim hardened: replaced `deno install` (which snapshots deno.json and
  caused a Zod 3-vs-4 stale-shim bug) with a TS launcher that points at the
  live config and source. Cross-platform via `Deno.build.os` — emits a
  `#!/bin/sh` script on Unix, a `.cmd` batch file on Windows. Contract locked
  with unit tests.
