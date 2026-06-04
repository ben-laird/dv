# Roadmap

What's deliberately parked. Living document — items move out as they
either land or get re-litigated.

For the **user-facing scope question** ("is feature X in v1?") see
[specs/v1-scope.md](specs/v1-scope.md). That file is authoritative for
the user-visible product surface and its deferral lists. This file
catches the rest: internal engineering threads, post-MVP polish, and
cross-cutting work that doesn't fit a single spec section.

## Start here (next session)

As of **0.7.1** (shipped 2026-06-03 via the one-trunk release-on-merge
flow), the loudest [post-first-release
follow-ups](#post-first-release-follow-ups-filed-2026-05-27) are closed:
the PR-body templating bug went away with the one-trunk move, and the
finalize/`deno.lock` staging bug is fixed (PR #9). The remaining
shortest-runway moves there are the **`dv release --json` two-shape
contract bug** (small, stability-of-contract) and the **`@dv-cli/clipc`
JSR score** (cosmetic JSDoc/README wins). After those, the next ceremony
candidate is the real `dv v1 @dv-cli/dv` 1.0 promotion — the rehearsal in
[Pre-1.0 work still to do](#pre-10-work-still-to-do) is the prerequisite.

## v1 product scope

### Breaking changes to land *before* the next 1.0 attempt

We tried promoting `@dv-cli/dv` to 1.0.0 once and walked it back (see
revert of `a9a32c1`) because the use-key redesign became visible
*during* the ceremony. Anything here would force a v2 if it landed
post-1.0; SemVer treats them as breaking, so they have to ship first.

*(Empty for now — the discriminated use-key redesign and its
migration command both landed pre-1.0, see Done below. The
@dv-cli/dv → 1.0.0 ceremony can rerun once we've audited the
remaining v1 commands.)*

### Commands shipped (the v1 surface)

The full v1 command set in [specs/cli.md](specs/cli.md) now exists.
This section is the running log of how each one landed; the spec is
authoritative for behavior.

- **`dv plugin list`** — read-only audit. Resolves every plugin
  in `.dv/config.yaml`, runs per-assignment discovery, and shows
  which packages each plugin claims. Non-fatal per-row: a broken
  plugin produces a `resolve-failed` / `discover-failed` row
  without hiding the rest. Complements `dv plugin verify`
  (per-plugin deep check) and `dv status` (per-Record preview).
- **`dv plugin invoke <plugin> <op>`** — single-Op debugger.
  Routes through `resolvePlugin` + `invokeOp` + the per-Op
  `parse*Response` so any contract drift surfaces here too (no
  parallel implementation). Positional `<plugin>` accepts the
  same discriminated forms as config (`path:`, `command:`,
  `builtin:`, `run:`) plus shape-inferred bare tokens.
- **`dv plugin verify <plugin>`** — conformance smoke test for
  CI. Runs `discover`, `read-version` per discovered package, and
  a bad-op exit-code check. Side-effectful ops
  (`write-version`, `update-dependency`, `release`) report as
  `skipped` rather than executed — there's no safe auto-undo for
  a manifest write or publish; authors should use `dv plugin
  invoke` against a throwaway fixture for those.
- **`dv rename <from> <to>`** — appends a lineage edge to
  `.dv/renames.yaml` (text-append so user comments survive). The
  `at` field is inferred from discovery's current version of the
  new package; `--at <version>` overrides the inference for cases
  where discovery can't reach the new name yet (e.g. unassigned
  glob, backdating). Refuses to add a duplicate outgoing edge
  from the same `from` — that would make Algebra §8's closure
  non-functional. Bookkeeping only: never touches the actual
  package.
- **`dv v1 <package>`** — commit `06cc1de`. Not yet exercised
  against `@dv-cli/dv` itself, pending another audit pass.
- **Discriminated `discovery.plugins[].use` key** — commits
  `40ab432` (path/builtin/command arms) and a follow-up adding the
  fourth `run:` arm for interpreter-style invocations like
  `deno run -A jsr:@scope/plugin`. Legacy string form errors with a
  targeted hint pointing at `dv migrate config`.
- **`dv migrate config`** — commit `5d5cd21`. Lives on the
  `subtools/config-migrations` subtool so the next breaking config
  change adds one `step-*.ts` file rather than growing this one
  command. Text-in / text-out per step so user comments survive
  the rewrite.

### Pre-1.0 work still to do

From the v1 audit (2026-05-25). Each is independently shippable.

- **`--debug` plugin tracing** — landed in commit `5dde93a`.
  Tool-wide flag pre-scanned at the binary boundary, threaded
  through every plugin invoker via optional `TracingHooks`.
  Renders one stderr block per invocation (op, env, stdin,
  stdout/stderr, exit, duration). Completes the plugin DX triad
  alongside `dv plugin invoke` / `verify`.
- **Spec sweep** — landed in commit `5dde93a`. Contract version
  documented in [specs/plugin-contract.md § Contract version](specs/plugin-contract.md#contract-version);
  `info` and `finalize` folded into
  [specs/v1-scope.md § Plugin contract](specs/v1-scope.md#plugin-contract).
- **1.0 ceremony rehearsal** — rehearsed against this repo on
  2026-05-25. `dv migrate config --dry-run` reports already-current
  shape; `dv version --dry-run` projects 0.5.0 → 0.6.0 (the two
  pending Records for finalize-summary and info-op); `dv v1
  @dv-cli/dv --dry-run --yes` projects 0.5.0 → 1.0.0 with
  @dv-cli/clipc's constraint rewritten; `dv plugin verify` against
  the deno example reports 4 pass, 0 fail. The real `dv v1`
  promotion is left as a deliberate next step rather than an
  autonomous one — 1.0 is one-way.
- **npm example plugin** (`examples/plugins/npm/main.ts`).
  Reference material for the most common non-Deno ecosystem. Copy
  `examples/plugins/deno/main.ts` and retarget at `package.json`
  (npm-style semver imports). Should implement the full op set
  including `info` and `finalize` (runs `npm install` to refresh
  `package-lock.json`). Optional — skip if you'd rather wait for
  the first real npm user.
- **Vitepress docs site** — wired up. `apps/docs/.vitepress/config.ts`
  anchors `srcDir` at the repo root and uses `rewrites` so
  `specs/foo.md` serves as `/foo`; `srcExclude` keeps READMEs,
  CLAUDEs, and other meta files out of the published surface.
  Landing page stays at `apps/docs/index.md`. Sidebar follows
  the read order from [apps/docs/CLAUDE.md](apps/docs/CLAUDE.md):
  Start here → Reference → Product. `deno task build` runs in
  `apps/docs/`; build output is gitignored.

### Post-first-release follow-ups (filed 2026-05-27)

Surfaced by dogfooding the full Release-PR bot loop end-to-end for
the first time (PRs #1 and #2, shipped `@dv-cli/dv` 0.7.0 via CI in
56 seconds). The loop worked; these are real warts the dogfood
exposed. Each is independently shippable.

- **✅ RESOLVED — PR body templating ran at the wrong time.** The old
  `dv-prepare-release.yml` ran `dv version` (consuming the Records),
  then `dv status --json | jq` to render the Release PR body — by
  which point pending Records were empty, leaving the body's "Pending
  bumps" section blank. Resolved when we moved to the one-trunk
  release-on-merge model: there's no Release PR to template, and the
  release script (`.github/scripts/release.ts`) captures the pending
  Plan *before* `dv version` runs for its log summary. The
  `dv-prepare-release.yml` workflow was deleted.
- **✅ RESOLVED (0.7.1) — `tools/dv-release` finalize didn't stage
  `deno.lock` on the last release.** Observed in @dv-cli/dv 0.6.0's
  release commit: I had to `git add deno.lock` and amend by hand
  before publishing. Root cause was the finalize op's *self-delta*
  check: it reported `deno.lock` only when its own `deno install`
  moved bytes, so lockfile drift introduced by earlier tooling (a
  warm-cache `deno check`/`test`, or even dv's own `deno run`
  startup) was invisible and never staged. Fixed in 0.7.1: the deno
  example + repo-local release plugins now report `deno.lock` when it
  differs from HEAD (`git status --porcelain`), not just on
  self-delta; and dv gained a post-stage backstop
  (`unstaged-finalize-drift`) that errors on a clean-tree run, or
  warns under `--allow-dirty`, when a finalize plugin leaves tracked
  files unstaged. The 0.7.1 release itself exercised the fixed path
  end-to-end. (PR #9.)
- **`@dv-cli/clipc` JSR score is 52%.** Easy wins: more JSDoc on
  public exports (router, command builders), a longer package
  README, maybe enable provenance once that's a stable JSR
  feature. The CLI itself (`@dv-cli/dv`) likely has the same
  opportunity. Cosmetic but visible on the JSR package page;
  raises adoption confidence.
- **`dv release --json` emits two top-level shapes.** A real run prints
  the wrapped envelope (`{ plan, mintedTagNames, reusedTagNames,
  releaseOpOutcomes, pushedTagNames }`); the no-op and `--dry-run` paths
  print the *bare* Plan instead (no wrapper). That divergence cuts
  against the "`--json` is a contract" invariant — consumers have to
  defensively probe for both shapes (the
  [release script](.github/scripts/release.ts) does). Fix: always emit
  the wrapped envelope, with empty `mintedTagNames` etc. on the no-op
  path. Small, but it's a stability-of-contract issue. Surfaced by the
  one-trunk CI work.

### Full "Release PR" → release-on-merge docs sweep

The CI/CD move to one-trunk release-on-merge (see
[ci-integration.md](apps/docs/content/guides/ci-integration.md)) updated
the headline docs (README, docs index, getting-started) and the
design/concept docs (`specs/design.md` §Two-phase release,
`concepts/two-phase-release.md`, CONTRIBUTING) to lead with
release-on-merge and present the Release PR as a *variant*. But "Release
PR" is still the canonical framing in the deeper docs, and they should be
swept to match in a dedicated pass:

- `apps/docs/content/guides/cut-a-release.md` — written entirely around
  landing a Release PR; rewrite release-on-merge-first.
- `specs/walkthrough.md` — the end-to-end walkthrough still merges a
  Release PR as the canonical step.
- `specs/language.md` — the **Release PR** term definition; keep the term
  (it's still a real concept) but note it's one of two workflows.
- `specs/cli.md`, `specs/v1-scope.md` — passing references to recheck.
- Source comments in `apps/cli/src/cli/version.ts`,
  `apps/cli/src/subtools/git/mod.ts`, and `.../git/commit.ts` call the
  commit "the Release PR" — fine as-is (it describes the commit), but
  worth a light reword for consistency.

Deferred deliberately: the headline docs are consistent now, so there's
no user-facing contradiction at the entry points; this is the long tail.

### Expose release notes in `dv release --json`

Surfaced by the one-trunk CI work: the release workflow mints a GitHub
Release per minted tag, and wants each release's notes for the body.
But `dv release --json` reports only *which* tags it minted
(`mintedTagNames`, plus the `awaitingRelease` Plan entries) — not the
notes. The workflow currently recovers them by re-parsing the relevant
section out of each package's `CHANGELOG.md` (the
[release script](.github/scripts/release.ts) slices `## [version]` …
next `## [`). That works but is fragile: it couples the consumer to
the CHANGELOG's exact formatting, and dv *already knows* the notes — it
just rendered them in `dv version`.

dv should expose release notes directly. dv has several sources it could
draw from and the right one is a design question, not a foregone
conclusion:

- **Re-render from the Records** — but `dv release` runs *after*
  `dv version` consumed them, so they're gone by release time.
- **Parse `CHANGELOG.md`** — dv owns the format, so a first-party parser
  is more robust than every consumer rolling their own slice. The
  changelog subtool (`apps/cli/src/subtools/changelog/`) already renders
  these sections; a matching extractor would close the loop.
- **Keep a lockfile / sidecar** — persist the rendered notes at
  `dv version` time for `dv release` to read back. Adds state, which
  cuts against "tags are the only release state."
- **Read from git** (tag annotation, commit body) — possible but
  indirect.

Likeliest shape: a `releaseNotes` (or `notes`) string per
`awaitingRelease` entry in the Plan schema (`specs/schemas/plan.json`,
regenerated from the Zod source — never hand-edited), populated by a
first-party CHANGELOG extractor. That makes "mint a GitHub Release with
the right body" a clean consumer of dv's JSON instead of a CHANGELOG
re-parser, and benefits any other release-notes consumer too. Pairs
naturally with the multi-channel publishing work below (a GitHub-Release
channel would want exactly this field).

### Opt into multi-channel publishing

A real product question, not just a bug. Today dv's release model
is **one plugin owns one package** — the package's plugin owns
every op including `release`. That means you can't have JSR + a
GitHub Release for the same package without writing both into one
plugin's `release` op.

A clean v2 design would let users wire a package to a primary
plugin (manifest ownership: read/write/update/finalize) AND one or
more publish-only "channels" that each fire their own `release` op
after tag minting. Concretely:

```yaml
discovery:
  plugins:
    - match: ["apps/*"]
      use: { run: "deno run -A ./tools/dv-release/main.ts" }
publishing:
  channels:
    - { for: "@dv-cli/dv", use: { run: "deno run -A ./tools/gh-releases.ts" } }
```

This is a contract change (new `info.supportedOps` shape for
channel-only plugins; new config section; dv release runs all
matching channels after the primary publish). Out of scope for v1;
worth doing once enough users want a second channel.

A working example release-only plugin already ships in
[examples/plugins/github-releases/main.ts](examples/plugins/github-releases/main.ts)
as the precedent — runnable via `dv plugin verify` / `dv plugin
invoke` today, ready to be wired in when the channels contract
lands.

### Deferred to later (architecturally accommodated)

Out of scope for v1 — see the full list with rationale in
[specs/v1-scope.md § Deferred to
later](specs/v1-scope.md#deferred-to-later). Highlights:

- First-party plugins (Cargo, npm, pyproject, etc.) promoted from
  copyable examples
- `dv plugin new` scaffolding command
- Snapshot / canary releases, pre-release tracks (alpha/beta/rc)
- Aggregate root `CHANGELOG.md`, full cascading bumps
- `dv record from-commit` / `from-range` (CC-accelerator affordances)
- GitHub Actions companion that maintains a Release PR

## Beyond v1

- **Roadmap entries as a first-class concept** — same Record/aggregator
  paradigm extended to planned work; the release boundary becomes the
  temporal seam. Full rationale in [specs/design.md § Deferred to v2:
  roadmaps](specs/design.md#deferred-to-v2-roadmaps). When this lands
  the underlying abstraction may earn a name like "ledger" with
  changelog and roadmap as concrete instances; don't introduce that
  abstraction preemptively.
- **TypeScript SDK** over the JSON contract — sugar layer once the
  contract is proven stable.

## Internal engineering threads

Tracked here because they're scaffolding/quality work that isn't
user-visible — the user-facing scope docs are the wrong home.

- **Errors-as-values in `@dv-cli/clipc`.** Landed via the router
  framework's `CliResponse` discriminated union (`{ kind: "ok" |
  "error" | "help" }`). Effect-style: typed errors are returned by
  runners and rendered by the framework; thrown errors are bugs we
  degrade gracefully on (caught at the trampoline boundary, wrapped
  into `code: "unknown"`). See `packages/cli/src/router/`.
- **Lift `requireRepoRoot` into a root-router pre-handler.** Today
  every dv leaf calls `requireRepoRoot()` independently. The router's
  parent-with-logic feature (a router's own `run` that can enrich
  ctx before delegating via `next(child, ...)`) lets us do the
  resolution once and put it in `DvCtx`. Each leaf then reads
  `ctx.repoRootPath` directly. Same trick can fold in
  `loadConfig(configPath(...))` for the commands that all need it.
  Trigger: the per-leaf calls are repetitive and slow the dv-side
  refactor cost of every new command.
- **Move printing out of runners into `CliResponse`.** Today's
  `runX()` functions print directly to stdout and leaves return
  `done({ kind: "ok" })`. The cleaner end state is for runners to
  return `{ stdout?, json? }` and let the framework's renderer
  print, so leaves are pure data and the framework owns IO. Big
  refactor; mostly mechanical (every console.log moves into a
  string-builder) but each leaf needs visual diff against the
  current output before/after. Worth doing when we add a second
  consumer that wants to capture dv's output programmatically
  (e.g. a TUI shell that drives `dv status` and renders inline).
- **Surface router/leaf descriptions in parent listings.** Sub-router
  rows in `dv --help` show the sub-router's own description but not
  its children's; today you have to descend one level to see what's
  inside. A two-line listing (`plugin    Plugin authoring + audit /
  list, invoke, verify`) or an inline child preview would make the
  top-level help self-explanatory. Implementation lives in
  `packages/cli/src/router/help.ts`.
- **Real prompt subtool.** `dv release`'s confirmation uses the
  built-in `Deno.prompt`. Replace with a proper prompt subtool when
  any second command needs one (and probably worth doing alongside
  the [SolidJS TUI question](#solidjs-tui) if that gets revisited).
  Pointer: [apps/cli/src/cli/release.ts:334](apps/cli/src/cli/release.ts#L334).
- **Rust rewrite trigger conditions.** v1 ships TypeScript on Deno;
  a Rust rewrite earns consideration only when the trigger conditions
  in [specs/design.md § Implementation
  language](specs/design.md#implementation-language) actually bind
  (cold-start cost is felt, distribution friction matters, the API is
  stable enough to warrant the polish). Not a roadmap item — a
  watchlist condition.
- <span id="solidjs-tui">**SolidJS-based TUI rendering.**</span>
  Considered as a reactive substrate for `dv`'s interactive surfaces
  (prompts, progress, the `dv add` flow). Deferred — `dv` is a
  composable Unix primitive; most invocations exit immediately and
  reactivity buys little. Revisit when there's a sustained interactive
  surface to drive (multi-step wizards, a watch mode, a TUI dashboard
  command).

## Non-goals

For "deliberately never going to do this" items, see [specs/v1-scope.md
§ Non-goals (probably
forever)](specs/v1-scope.md#non-goals-probably-forever). Highlights:
embedded AI features, hosted services, alternative VCSes, replacing
publish mechanisms, integrations with external services.
