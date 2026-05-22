# packages/ — shared Deno libraries

Slot for shared Deno workspace members consumed by apps under `../apps/`.
Empty for now.

## Adding a package

When you create `packages/foo/`:

1. Give it a `deno.json` with `"name"`, `"version"`, and `"exports"`.
2. Append `"./packages/foo"` to the `workspace` array in the root
   `deno.json` — Deno workspaces don't expand globs.
3. If the package's domain is non-trivial, add `packages/foo/CLAUDE.md`
   following the lazy-loaded pattern used in `apps/cli/` and `apps/docs/`.
4. Apps consume it by name (e.g. `import { ... } from "@seshat/foo"`)
   once the package's name is registered in its own `deno.json`.
