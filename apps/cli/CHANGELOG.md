# Changelog

All notable changes to this Package are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this Package adheres to [Semantic Versioning](https://semver.org/).

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
