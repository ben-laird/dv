---
type: feat
packages:
  - '@dv-cli/dv'
notes: >-
  Every dv --json output now carries a versioned schema URN and validates against a committed JSON
  Schema under specs/schemas/. A central registry (domain/schema-urns.ts) is the single source of
  truth for contract ids, dv release --json gained its previously-missing envelope stamp, and a
  generator gate rejects any unversioned contract id.
---

Freeze and version-stamp the --json contract
