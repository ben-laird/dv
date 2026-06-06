# Changelog

All notable changes to this Package are documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this Package adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-06-06

### Changed

- **BREAKING** Stop exporting the raw Zod error schemas; validate via Zod-free parser functions instead

## [0.3.1] - 2026-06-04

### Fixed

- Document the full public API surface with JSDoc for JSR

## [0.3.0] - 2026-05-27

### Changed

- **BREAKING** Rename packages from @seshat/* to @dv-cli/*

## [0.2.0] - 2026-05-25

### Added

- Preview sub-router children inline in router --help

### Changed

- **BREAKING** Replace command-spec API with router-based framework

### Fixed

- Make sub-router children visually distinct in help

## [0.1.0] - 2026-05-22

### Added

- Introduce @dv-cli/clipc — a minimal argv-dispatch framework
