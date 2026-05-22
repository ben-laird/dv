---
type: feat
packages:
  - "@seshat/dv"
---

# Implement M4: constraint cascading

When a Package bumps, every other discovered Package gets its
manifest constraint on the bumped Package rewritten — but is never
itself bumped (specs/language.md Algebra §9: cascade is constraint-
only).

- `update-dependency` plugin Op: stdin JSON in, `{ok:true, changed:bool}`
  out. `changed:false` is the documented no-op when a dependent
  doesn't carry the named dependency, so plugins don't have to track
  the dependency graph for dv.
- Plan builder pre-populates `constraintUpdates` as the bumped ×
  every-other-discovered-package cross product, sorted for byte-
  stable JSON. `dv status` and `dv version --dry-run` both surface
  "would update dependents: …" predictively; the plugin filters at
  execute time.
- `dv version` runs a cascade pass after every `write-version` so a
  dependent that is itself in pending gets its constraint rewritten
  on top of its own already-bumped manifest. Only dependents whose
  plugin reported `changed:true` are added to the staging set.
- Example deno plugin's `update-dependency` honors any existing
  range prefix (`^`, `~`, exact) and defaults to caret for
  unrecognized forms — the modern Deno convention.
- POSIX-shell tokenizer for `$EDITOR` / `$VISUAL` plus a `--editor`
  flag on `dv add`. Quoted paths and escaped spaces now work
  identically to git's behavior.
- Editor temp file lives in `<repoRoot>/.changelog/` (matching
  `.git/COMMIT_EDITMSG`) so VSCode and similar editors inherit
  workspace trust; `dv init` now writes `.changelog/.gitignore` so
  every fresh repo starts with the right ignore rules.
