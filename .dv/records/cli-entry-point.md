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

**Breaking:** the library surface (`main`, the `run*` command runners and the
`Plan` contract types) moves to the `./lib` export. Update imports from
`@dv-cli/dv` to `@dv-cli/dv/lib`:

```ts
import { runStatus, type Plan } from "@dv-cli/dv/lib";
```
