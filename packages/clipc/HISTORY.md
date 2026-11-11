# History

Long-form release notes for this Package. Each version section carries
one h3 subsection per Record consumed during that release, with the
Record's body prose verbatim. For terse one-line bullets, see
CHANGELOG.md.

## [0.4.2] - 2026-11-11

### Treat a lone `-` as a word, not an unknown flag

`mycli add -` failed with `unknown flag '-'`, and a router skipped `-` as if
it were a flag. By Unix convention a bare `-` is an ordinary argument (it
often means stdin), so leaves now receive it as a positional word and routers
treat it as a subcommand name. A value flag takes it as its value in every
spelling: `--title -`, `-t -` and `--title=-` all set `title` to `-`. `-x`,
`--x` and `-5` before `--` are still refused as unknown flags.

## [0.4.1] - 2026-11-11

### Treat --help and -h after `--` as words, not a help request

`mycli add -- --help` printed the leaf's help instead of passing `--help` to
it. Everything after `--` is a positional word, never a switch, so routers
and leaves now look for `--help` and `-h` only before a `--`. Help before
`--` works as before at every level.

### Keep number-like positionals as the strings typed

A leaf's positional words reached `run` coerced to numbers whenever they
looked like one: `mycli add 007` gave the leaf `7`, `01234567` became
`1234567`, and `1e3` became `1000`. clipc now lists `_` under `string` when
it parses a leaf's argv, so every positional arrives exactly as typed. A leaf
that wants a number parses its own, since only it knows its types.

Declared `string` and `collect` flag values were never coerced, and an
undeclared flag is refused as `unknown-flag`, so no flag value changes.

## [0.4.0] - 2026-06-06

### Stop exporting the raw Zod error schemas; validate via Zod-free parser functions instead

## [0.3.1] - 2026-06-04

### Document the full public API surface with JSDoc for JSR

## [0.3.0] - 2026-05-27

### Rename packages from @seshat/* to @dv-cli/*

The @seshat scope was an internal codename. For the first JSR
publish we move to @dv-cli — a scope we own and that's discoverable
under dv's actual name. The CLI framework also gets a sharper name:
clipc (Command Line Interface Procedure Call), since 'cli' was too
generic to identify what the package does.

  @seshat/dv  → @dv-cli/dv
  @seshat/cli → @dv-cli/clipc

The package directory packages/cli/ also moves to packages/clipc/ so
the on-disk name matches the published name.

Migration for downstream users: update any import paths from
@seshat/* to @dv-cli/* — they're the same packages, just renamed.
The CLI binary is still dv; the contract surface is unchanged.

## [0.2.0] - 2026-05-25

### Preview sub-router children inline in router --help

### Make sub-router children visually distinct in help

### Replace command-spec API with router-based framework
