---
type: feat!
packages:
  - '@dv-cli/dv'
links:
  - https://github.com/ben-laird/dv/issues/45
---

# `deno install jsr:@dv-cli/dv` installs a working `dv`; the library moves to `@dv-cli/dv/lib`

The package's default export was the library module, which never ran the CLI,
so `deno install jsr:@dv-cli/dv` produced a binary that exited 0 and did
nothing. The default export is now the CLI entry point, so the documented
install command yields a working `dv`.

**Breaking:** everything else the bare specifier used to export moves to the
`./lib` export: the `run*` command runners, the `PLUGIN_OP_NAMES`,
`CHANGE_TYPES`, `SCHEMA_URNS` and `SCHEMA_URN_MAJOR` constants, and all the
exported types (runner options and results, the `Plan` contract types, and the
domain types they reference). Update those imports from `@dv-cli/dv` to
`@dv-cli/dv/lib`:

```ts
import { runStatus, type Plan } from "@dv-cli/dv/lib";
```

`main` is unaffected: it is still exported from `@dv-cli/dv`, and also from
`@dv-cli/dv/lib`.
