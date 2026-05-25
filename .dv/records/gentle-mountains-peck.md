---
type: fix
packages:
  - '@seshat/dv'
notes: >-
  Adds a `↳ refreshed N files (path1, path2)` line to the human summary so users can see what
  additional files (typically lockfiles) finalize staged into the commit. RunVersionResult and
  RunV1Result also grow a typed `finalizedFiles[]` field for scripted consumers. The summary line is
  omitted when finalize reported no changes (the common case for runs that did not actually shift
  any lockfiles).
---

Surface files refreshed by finalize in the dv version / dv v1 summary
