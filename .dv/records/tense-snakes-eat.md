---
type: fix
packages:
  - '@dv-cli/dv'
---

Annotate the public Plan schema symbols with explicit types so deno publish passes the JSR slow-types check. The 0.8.0 release minted its tag but failed to publish because lib.ts exposed plan-schema.ts inferred Zod consts as public API.
