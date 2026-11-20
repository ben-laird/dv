---
type: 'feat!'
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/46
---

# Let a value flag name its value in `--help`

A `string` or `collect` flag can set `valueName` to say what its value is:
`{ kind: "string", valueName: "path" }` renders `--out <path>` in a leaf's
`--help` instead of `--out <string>`. Flags without it render as before.

**Breaking (types):** `formatCommandHelp`'s `flags` narrowed from a loose
`Record<string, { kind: string; description?; alias? }>` to
`Record<string, FlagSpec>`, the type a leaf declares. A caller passing flag
objects with a `kind` outside `FlagSpec` no longer type-checks.
