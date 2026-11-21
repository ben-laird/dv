# Changelog

All notable changes to this Package are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this Package adheres to [Semantic Versioning](https://semver.org/).

## [0.13.1] - 2026-11-21

### Fixed

- Plugin stderr from successful Ops now reaches dv's stderr, each line prefixed with the Op (and the Package, for per-Package Ops), as the plugin contract promises. Previously it was only visible under --debug, so warnings such as the Deno example's import-map fallback were silently dropped. stdout (and --json output) is unaffected.
- dv release's human summary now counts only real publishes. A release op that answers published: false (for example a package marked "publish": false) shows as "N not published" instead of being counted as published, and one that answers skipped: true (already published) shows as "N skipped".

## [0.13.0] - 2026-11-20

### Added

- dv migrate config now moves the config schema pointers (the `# yaml-language-server` modeline and the `$schema` key) forward to the running dv release when they name an older one, and leaves any other URL alone.
- Publish dv's JSON Schemas with each release at `https://jsr.io/@dv-cli/dv/<version>/schemas/<name>.json`, and have dv init point the new config at the config schema for the running version (a yaml-language-server modeline plus a `$schema` key).
- dv validate now reports non-fatal warnings (a `warnings` array in `--json`, `⚠` lines and a count in the summary) that never change the exit code. The first ones flag a config schema pointer that names a different dv release, or a config with only one of the two pointers.

## [0.12.1] - 2026-11-20

### Fixed

- Run plugins from the repo root, whatever directory dv runs from ([link](https://github.com/ben-laird/dv/issues/52))

## [0.12.0] - 2026-11-20

### Changed

- **BREAKING** `deno install jsr:@dv-cli/dv` installs a working `dv`; the library moves to `@dv-cli/dv/lib` ([link](https://github.com/ben-laird/dv/issues/45))

### Fixed

- `dv --version` reports the installed version ([link](https://github.com/ben-laird/dv/issues/43))

## [0.11.0] - 2026-06-08

### Added

- Expose release notes in dv release --json
- Freeze and version-stamp the --json contract

## [0.10.0] - 2026-06-08

### Added

- Expose release notes in dv release --json

## [0.9.0] - 2026-06-06

### Added

- Document the entire public library surface with JSDoc and re-export the domain and contract types it references

## [0.8.1] - 2026-06-05

### Fixed

- Annotate the public Plan schema symbols with explicit types so deno publish passes the JSR slow-types check. The 0.8.0 release minted its tag but failed to publish because lib.ts exposed plan-schema.ts inferred Zod consts as public API.

## [0.8.0] - 2026-06-04

### Added

- Add a public programmatic API for driving dv in-process

## [0.7.3] - 2026-06-04

### Fixed

- Document the dv programmatic entrypoint with JSDoc for JSR

## [0.7.2] - 2026-06-04

### Fixed

- Always emit the wrapped envelope from dv release --json, including on no-op and dry-run paths

## [0.7.1] - 2026-06-03

### Fixed

- Stage refreshed lockfiles into the version commit even when they drifted before finalize ran
- Only list real dependents in version/status constraint cascade, not every other package

## [0.7.0] - 2026-05-27

### Added

- feat(release): add get-dependencies plugin op + topological publish order

## [0.6.0] - 2026-05-27

### Changed

- **BREAKING** Rename packages from @seshat/* to @dv-cli/*
- **BREAKING** Add mandatory `info` plugin op for contract-version negotiation

### Fixed

- Surface files refreshed by finalize in the dv version / dv v1 summary

## [0.5.0] - 2026-05-25

### Added

- Add finalize plugin op so generated companion files ship with the version commit

## [0.4.0] - 2026-05-25

### Added

- Migrate every command to the @dv-cli/clipc router framework

## [0.3.0] - 2026-05-22

### Added

- Add opt-in HISTORY.md long-form release notes

## [0.2.0] - 2026-05-22

### Added

- Implement M4: constraint cascading

## [0.1.0] - 2026-05-22

### Added

- Implement M1: `dv init`, config parsing, discovery, and `dv status` scaffolding
- Implement M2: `dv add`, `dv validate`, and the rename ledger
