---
type: fix
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/39
---

# Keep number-like positionals as the strings typed

A leaf's positional words reached `run` coerced to numbers whenever they
looked like one: `mycli add 007` gave the leaf `7`, `01234567` became
`1234567`, and `1e3` became `1000`. clipc now lists `_` under `string` when
it parses a leaf's argv, so every positional arrives exactly as typed. A leaf
that wants a number parses its own, since only it knows its types.

Declared `string` and `collect` flag values were never coerced, and an
undeclared flag is refused as `unknown-flag`, so no flag value changes.
