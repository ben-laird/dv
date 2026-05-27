---
type: feat
packages:
  - '@dv-cli/dv'
notes: >-
  Add optional get-dependencies plugin op; dv release topologically orders publishes so dependencies
  ship before dependents. Plugins that don't implement the op fall back to alphabetical-by-path
  order. New release-cycle error code for circular workspace deps.
---

feat(release): add get-dependencies plugin op + topological publish order

The fix for the publish-order bug we hit when shipping @dv-cli/dv
0.6.0 before @dv-cli/clipc was on JSR. dv release now sorts its
work list so dependencies publish before their dependents — a hard
requirement for registries (JSR especially) that resolve manifest
imports at publish time.

New optional plugin op: get-dependencies. Plugins inspect their
package's manifest and return the strict subset of dv-supplied
candidates that this package depends on (in any manifest field —
runtime/dev/peer for npm; imports for Deno). The op is optional;
plugins that don't declare it in info.supportedOps trigger the
alphabetical-by-path fallback (the pre-fix behavior, so monorepos
without cross-package deps see no change).

Workspace cycles raise the new release-cycle DvError naming all
cyclic members — no partial publishes.

Implementation:
- specs/plugin-contract.md gets the new op section + subtool map
  entry
- Zod source + hand-maintained JSON Schema artifact updated
- Pure topological-sort helper with 9 dedicated tests (cycles,
  diamonds, ties-by-input-position, external-dep filtering, etc.)
- release.ts loads pluginInfo up-front (matching version.ts/v1.ts
  pattern), probes get-dependencies for each work-list pkg whose
  plugin supports it, top-sorts, errors on cycle
- All three plugins (tools/dv-release + both examples) implement
  the new op
- plugin-invoke + plugin-verify gain support so the dev-tooling
  triad stays consistent (PLUGIN_OP_NAMES, summarizeResponse,
  conformanceCheck, plus an end-to-end empty-candidates probe in
  verify)

Two new release.ts integration tests:
- publishes dependencies before dependents (the regression — the
  exact shape that hit us in production: pkg-a alphabetically
  first but depends on pkg-b, so pkg-b must publish first)
- throws release-cycle on a circular workspace dependency

Backward compat: the op is additive + optional, so contractVersion
stays at "1". Plugins predating this change keep working unchanged.
Non-breaking by every test we have.
