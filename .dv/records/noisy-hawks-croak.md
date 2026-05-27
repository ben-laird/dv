---
type: feat!
packages:
  - '@dv-cli/dv'
  - '@dv-cli/clipc'
notes: >-
  Rename packages: @seshat/dv → @dv-cli/dv and @seshat/cli → @dv-cli/clipc. Seshat was an internal
  codename; the published JSR packages live under @dv-cli/. Existing users must update their
  imports.
---

Rename packages from @seshat/* to @dv-cli/*

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
