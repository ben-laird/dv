---
type: fix
packages:
  - '@dv-cli/dv'
notes: >-
  The finalize op now reports deno.lock when it differs from HEAD (git status --porcelain) rather
  than only when its own deno install moved bytes — so lockfile drift introduced by earlier tooling
  (e.g. a warm-cache deno check/test) still ships in the version commit. dv also gained a post-stage
  guard (unstaged-finalize-drift) that errors on a clean-tree run, or warns under --allow-dirty,
  when a finalize plugin leaves tracked files unstaged.
---

Stage refreshed lockfiles into the version commit even when they drifted before finalize ran
