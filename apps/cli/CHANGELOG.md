# Changelog

All notable changes to this Package are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this Package adheres to [Semantic Versioning](https://semver.org/).

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
