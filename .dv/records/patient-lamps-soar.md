---
type: feat
packages:
  - '@dv-cli/dv'
notes: >-
  Adds JSDoc to every exported symbol on @dv-cli/dv's library entry (runners, option/result
  interfaces, Plan contract). Re-exports the domain types reachable through the public option/result
  shapes (ChangeType, Package, PluginReference, PluginAssignment, ResolvedPlugin, SlugRandomSource,
  ConfigMigrationStepResult, MigrationChange, PluginConstraintUpdate, PLUGIN_OP_NAMES) so they can
  be imported by name. The Plan contract types are now hand-written interfaces instead of z.infer
  aliases, keeping Zod's internal types off the public surface. deno doc --lint is now a hard CI
  gate.
---

Document the entire public library surface with JSDoc and re-export the domain and contract types it references
