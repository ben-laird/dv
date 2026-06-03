---
type: fix
packages:
  - '@dv-cli/dv'
notes: >-
  dv version, dv status, and dv v1 now resolve the dependency graph via the plugin's
  get-dependencies op and report only packages that actually depend on a bumped one. Previously the
  plan listed the full cross-product of every other discovered package, so the dry-run 'would update
  dependents' line named packages that don't carry the dependency (e.g. a sibling that the bumped
  package depends on). When a plugin doesn't implement get-dependencies, dv falls back to the prior
  candidate cross-product and the plugin still filters at execute time.
---

Only list real dependents in version/status constraint cascade, not every other package
