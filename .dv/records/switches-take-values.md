---
type: 'feat!'
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/46
---

# Add `optional-value` flags: a switch with an optional attached value

A flag declared `{ kind: "optional-value" }` reads `--x` as `true`,
`--no-x` as `false`, and `--x=<value>` as that value. The value must be
attached with `=`: `--x word` switches the flag on and leaves `word` as a
positional. What may follow `=` is a small vocabulary:

- `values: ["null"]` closes the set; the leaf sees those literals, and any
  other value is refused with an `invalid-flag-value` error (exit 2) that
  lists the accepted spellings. Without `values`, any string is accepted.
- `booleans: true` also reads `=true` / `=false` as booleans.

So `{ kind: "optional-value", values: ["null"], booleans: true }` accepts
`--askOnCommit`, `--no-askOnCommit`, `--askOnCommit=true|false|null`, is
typed `boolean | "null" | undefined`, and shows in `--help` as
`--askOnCommit[=true|false|null]` (`--x[=<string>]` for a free value, or
`--x[=<valueName>]` when it names its value). A CLI that declared such a
flag as a `string` and re-parsed it can declare it directly instead.
Declaring a separate `no-x` flag beside an optional-value `x` makes
`command()` throw when the tree is built, since `--no-x` already means
`false`: drop the separate `no-x` flag. Flag errors are now reported in the
order they were typed.

**Breaking (types):**

- `FlagSpec` gained the `"optional-value"` arm, so an exhaustive `switch` on
  `flagSpec.kind` no longer compiles until it handles the new kind.
- `LoweredFlagSpec` gained a required `optionalValue: string[]`. Code that
  builds a `LoweredFlagSpec` by hand must add it. A custom parser that feeds
  `lowerFlagSpec`'s output to `parseArgs` silently drops optional-value
  flags (they are in no `parseArgs` bucket) unless it reads `optionalValue`
  and handles those spellings itself: `parseArgs` treats them as unknown.
- `command()`'s flag map is now a `const` type parameter, like `forCtx`'s.
  A plain `command({...})` now infers literal and `readonly` flag types,
  which can change what an explicitly annotated variable must accept.
