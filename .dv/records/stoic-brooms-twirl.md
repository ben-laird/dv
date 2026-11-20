---
type: feat
packages:
  - '@dv-cli/dv'
---

dv validate now reports non-fatal warnings (a `warnings` array in `--json`, `⚠` lines and a count in the summary) that never change the exit code. The first ones flag a config schema pointer that names a different dv release, or a config with only one of the two pointers.
