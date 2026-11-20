---
type: fix
packages:
  - '@dv-cli/dv'
links:
  - https://github.com/ben-laird/dv/issues/43
---

# `dv --version` reports the installed version

`dv --version` and the `dv status` banner printed a stale, hand-maintained
`0.1.0` regardless of the installed release. dv now reads its version from its
own package manifest, so both always match the published version.
