# History

Long-form release notes for this Package. Each version section carries
one h3 subsection per Record consumed during that release, with the
Record's body prose verbatim. For terse one-line bullets, see
CHANGELOG.md.

## [0.10.0] - 2026-06-08

### Expose release notes in dv release --json

## [0.9.0] - 2026-06-06

### Document the entire public library surface with JSDoc and re-export the domain and contract types it references

## [0.8.1] - 2026-06-05

### Annotate the public Plan schema symbols with explicit types so deno publish passes the JSR slow-types check. The 0.8.0 release minted its tag but failed to publish because lib.ts exposed plan-schema.ts inferred Zod consts as public API.

## [0.8.0] - 2026-06-04

### Add a public programmatic API for driving dv in-process

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

## [0.7.3] - 2026-06-04

### Document the dv programmatic entrypoint with JSDoc for JSR

## [0.7.2] - 2026-06-04

### Always emit the wrapped envelope from dv release --json, including on no-op and dry-run paths

## [0.7.1] - 2026-06-03

### Stage refreshed lockfiles into the version commit even when they drifted before finalize ran

### Only list real dependents in version/status constraint cascade, not every other package

## [0.7.0] - 2026-05-27

### feat(release): add get-dependencies plugin op + topological publish order

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

## [0.6.0] - 2026-05-27

### Surface files refreshed by finalize in the dv version / dv v1 summary

### Rename packages from @seshat/* to @dv-cli/*

The @seshat scope was an internal codename. For the first JSR
publish we move to @dv-cli — a scope we own and that's discoverable
under dv's actual name. The CLI framework also gets a sharper name:
clipc (Command Line Interface Procedure Call), since 'cli' was too
generic to identify what the package does.

  @seshat/dv  → @dv-cli/dv
  @seshat/cli → @dv-cli/clipc

The package directory packages/cli/ also moves to packages/clipc/ so
the on-disk name matches the published name.

Migration for downstream users: update any import paths from
@seshat/* to @dv-cli/* — they're the same packages, just renamed.
The CLI binary is still dv; the contract surface is unchanged.

### Add mandatory `info` plugin op for contract-version negotiation

## [0.5.0] - 2026-05-25

### Add finalize plugin op so generated companion files ship with the version commit

## [0.4.0] - 2026-05-25

### Migrate every command to the @dv-cli/clipc router framework

## [0.3.0] - 2026-05-22

### Add opt-in HISTORY.md long-form release notes

A new `history` subtool writes a per-Package `HISTORY.md` alongside
`CHANGELOG.md` when `history.enabled: true` in
`.dv/config.yaml`. The two documents are complementary:
CHANGELOG stays terse per Keep a Changelog (single-line bullets);
HISTORY carries each Record's full body prose under per-version h3
subsections.

Opt-in by default — every existing dv repo sees zero behavior change
on the next bump. Format mirrors CHANGELOG's: `## [version] - date`
sections with the same splice rule (above the first non-`Unreleased`
heading) and a HISTORY-specific preamble that explicitly points
readers at CHANGELOG.md for terse bullets.

The renderer reuses `extractHeadline` from the changelog subtool so
the headline semantics stay aligned. Records leading with an h1
become an h3 subsection in HISTORY with the body prose verbatim
below it. Records without an h1 (pre-v1 convention) fall back to
first-non-empty-line as the title and the rest of the body as the
entry content. Breaking flavors get no special treatment in HISTORY
— HISTORY is narrative, not structured; CHANGELOG keeps the
`**BREAKING**` emphasis.

Same `overrides[].history` shape as `overrides[].changelog` for
per-Package customization. Config + flag parity holds: `history` is
config-only because it's repo-definition, not runtime behavior
(like `changelog.location`).
