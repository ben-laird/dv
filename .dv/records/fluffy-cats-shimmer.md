---
type: fix
packages:
  - '@dv-cli/dv'
notes: >-
  Previously dv release --json emitted two shapes: the wrapped envelope ({ plan, mintedTagNames,
  reusedTagNames, releaseOpOutcomes, pushedTagNames }) on a real run, but the bare Plan on the no-op
  and --dry-run paths. That forced consumers to defensively probe for both shapes, violating the
  '--json is a contract' invariant. Now all three paths emit the same wrapped envelope, with empty
  action arrays on no-op/dry-run. The repo's own .github/scripts/release.ts consumer is simplified
  to parse the single shape.
---

Always emit the wrapped envelope from dv release --json, including on no-op and dry-run paths
