---
type: feat
packages:
  - '@dv-cli/dv'
notes: >-
  dv release --json now exposes each awaiting-release entry's CHANGELOG section as a releaseNotes
  field, so consumers (e.g. a GitHub Release channel) no longer re-parse CHANGELOG.md themselves.
---

Expose release notes in dv release --json
