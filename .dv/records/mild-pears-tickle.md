---
type: feat
packages:
  - '@seshat/dv'
notes: >-
  main.ts shrinks from ~630 lines of hand-dispatched command specs to ~55 lines that build a root
  router and hand off to the framework. dv migrate and dv plugin are now proper sub-routers; --help
  text is auto-generated from the tree.
---

Migrate every command to the @seshat/cli router framework
