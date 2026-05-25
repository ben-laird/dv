---
type: feat!
packages:
  - '@seshat/dv'
notes: >-
  New mandatory `info` op every plugin must implement. dv invokes it once per plugin per run
  (cached) before any other op. Returns `{contractVersion, supportedOps, name?, version?}`. dv
  refuses to run against an incompatible contractVersion (hard error), and skips optional ops the
  plugin does not declare in supportedOps. Replaces the per-response `unsupported:true` escape hatch
  on finalize — the op-declaration mechanism (info) is the answer to "does this plugin support op
  X?". Existing plugins must add an `info` case; the example deno plugin is updated as a reference.
  Currently dv version and dv v1 invoke info up-front; dv status / validate skip info since they
  only call mandatory ops (discover, read-version) whose shapes have not changed.
---

Add mandatory `info` plugin op for contract-version negotiation
