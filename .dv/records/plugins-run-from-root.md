---
type: fix
packages:
  - '@dv-cli/dv'
links:
  - https://github.com/ben-laird/dv/issues/52
---

# Run plugins from the repo root, whatever directory dv runs from

dv spawned plugins in the caller's working directory, so a relative path in
a `run:` reference (`deno run -A ./tools/my-plugin/main.ts`) failed with
"Module not found" when dv ran from a subdirectory. dv now always starts the
plugin process in the repo root, so `dv status` and the other plugin-driving
commands work from anywhere in the repository. The plugin contract now states
this. Without `--repo-root`, `dv plugin invoke` and `dv plugin verify` now use
the git repo root containing the current directory, or the current directory
itself outside a git repo.
