---
type: feat!
packages:
  - '@seshat/cli'
notes: >-
  Old `defineCli({commands:{...}})` + `defineCommand({...})` are removed entirely. The replacement
  is `defineCli({rootRouter})` where the root is built with `router({commands:{...}})` (containing
  `command({flags,run})` leaves and nested `router(...)` sub-routers). See specs and the
  apps/cli/src/cli/router/ directory for the new shape.
---

Replace command-spec API with router-based framework
