---
type: feat
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/46
---

# Add `optional-value` flags: a switch with an optional attached value

A flag declared `{ kind: "optional-value", values: ["null"] }` reads
`--askOnCommit` as `true`, `--no-askOnCommit` as `false`, and
`--askOnCommit=null` as `"null"`, and the leaf sees it typed
`boolean | "null" | undefined`. The value must be attached with `=`:
`--askOnCommit null` switches the flag on and leaves `null` as a positional
word. A value outside `values` is refused with an `invalid-flag-value` error
(exit 2) naming the flag, the value and the choices. `--help` shows the flag as
`--askOnCommit[=null]`, or `--askOnCommit[=<valueName>]` when it names its
value. A CLI that declared such a flag as a `string` and re-parsed it can
declare it directly instead. `lowerFlagSpec` lists these flags under a new
`optionalValue` key, since `parseArgs` has no optional attached value.
