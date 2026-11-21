---
type: 'feat!'
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/51
---

# Rename an optional-value flag's `values` to `choices`

The closed set of literals an `optional-value` flag accepts after `=` is
now declared as `choices`, which frees "value" to mean the thing a flag
carries. Behavior, help text and the `invalid-flag-value` error are
unchanged.

**Breaking (types):** `values` is gone, with no alias. Rename the field:

```diff
- askOnCommit: { kind: "optional-value", values: ["null"], booleans: true },
+ askOnCommit: { kind: "optional-value", choices: ["null"], booleans: true },
```

The error `command()` throws for `"true"` / `"false"` declared beside
`booleans: true` now names `choices` too.
