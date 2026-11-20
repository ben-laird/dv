---
type: fix
packages:
  - '@dv-cli/dv'
---

Plugin stderr from successful Ops now reaches dv's stderr, each line prefixed with the plugin and Op, as the plugin contract promises. Previously it was only visible under --debug, so warnings such as the Deno example's import-map fallback were silently dropped. stdout (and --json output) is unaffected.
