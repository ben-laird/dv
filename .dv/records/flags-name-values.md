---
type: feat
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/46
---

# Let a value flag name its value in `--help`

A `string` or `collect` flag can set `valueName` to say what its value is:
`{ kind: "string", valueName: "path" }` renders `--out <path>` in a leaf's
`--help` instead of `--out <string>`. Flags without it render as before.
`formatCommandHelp` now takes its `flags` as a `FlagSpec` map, the same type a
leaf declares.
