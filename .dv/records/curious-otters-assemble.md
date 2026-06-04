---
type: feat
packages:
  - '@dv-cli/dv'
notes: >-
  Promotes the existing in-process command runners to a documented public
  library surface. New `./src/lib.ts` barrel becomes the package `exports`
  entry; it re-exports `main` plus every `runX` runner (runStatus, runVersion,
  runRelease, runValidate, runV1/runV1Catalog, runInit, runAdd, runRename,
  runMigrateConfig, runPlugin{List,Invoke,Verify}) with their Options/Result
  types, and forwards the `Plan` contract types from the versioning subtool.
  `import { main } from "@dv-cli/dv"` keeps working (lib re-exports it), so
  this is additive — no export removed. Runners still print to stdout as a
  side effect (documented caveat); a side-effect-free capturing entry point
  and a separate typed SDK remain deferred pending contract stabilization.
---

Add a public programmatic API for driving dv in-process

`@dv-cli/dv` now exposes a typed library surface alongside the CLI binary.
Import the command runners directly to drive `dv` without spawning a
subprocess — each returns the same typed data the `--json` contract
serializes (e.g. `runStatus` and `runVersion` return a `Plan`, `runRelease`
returns the release envelope):

```ts
import { runStatus, type Plan } from "@dv-cli/dv";

const { plan } = await runStatus({ emitJson: false, colorEnabled: false });
```

The binary entry point `main(argv)` is still exported (now re-exported from
the new library barrel), so existing programmatic callers are unaffected.

> [!NOTE]
> The runners write their human or `--json` render to stdout as a side
> effect; the typed return value is in addition to that output. A
> side-effect-free capturing entry point is a candidate for a later release.
