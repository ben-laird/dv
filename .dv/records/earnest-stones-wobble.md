---
type: fix
packages:
  - '@dv-cli/clipc'
notes: >-
  Every public export of @dv-cli/clipc (router, command, defineCli, CliError, renderCliError,
  FlagSpec, the request/response/Step types, and their members) now carries TSDoc — summaries,
  @param/@returns, and @example on the core builder API. Raises the JSR documented-symbols score
  from 0%. Also brought packages/clipc under Biome management (it was excluded from biome.json
  includes) so the published package is formatter/linter-checked like the rest of the repo.
---

Document the full public API surface with JSDoc for JSR
