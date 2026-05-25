---
type: feat
packages:
  - '@seshat/dv'
notes: >-
  New optional `finalize` plugin op fires once per plugin per `dv version` / `dv v1` run, after
  every write-version + cascade update-dependency call has settled but before staging + committing.
  The plugin returns `additionalChangedFiles[]` (paths relative to repo root) that dv adds to the
  stage. Plugins predating the op use the `{ok:true, unsupported:true}` escape hatch. The deno
  example plugin runs `deno install --quiet` to refresh `deno.lock` so future `dv version` runs
  leave a clean working tree instead of dirtying it with a stale lockfile.
---

Add finalize plugin op so generated companion files ship with the version commit
