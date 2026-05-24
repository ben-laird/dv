# Roadmap

What's deliberately parked. Living document — items move out as they
either land or get re-litigated.

For the **user-facing scope question** ("is feature X in v1?") see
[specs/v1-scope.md](specs/v1-scope.md). That file is authoritative for
the user-visible product surface and its deferral lists. This file
catches the rest: internal engineering threads, post-MVP polish, and
cross-cutting work that doesn't fit a single spec section.

## v1 product scope

### Breaking changes to land *before* the next 1.0 attempt

We tried promoting `@seshat/dv` to 1.0.0 once and walked it back (see
revert of `a9a32c1`) because the use-key redesign became visible
*during* the ceremony. Anything here would force a v2 if it landed
post-1.0; SemVer treats them as breaking, so they have to ship first.

*(Empty for now — the discriminated use-key redesign and its
migration command both landed pre-1.0, see Done below. The
@seshat/dv → 1.0.0 ceremony can rerun once we've audited the
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
  against `@seshat/dv` itself, pending another audit pass.
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

- **Errors-as-values (Result<T, E>) in `@seshat/cli`.** Considered
  during the EC1–EC7 structured-error sweep and deliberately deferred
  to keep that sweep atomic. The current model is exception-based
  throw → framework catch → `renderCliError`. A Result-based API
  would let runners *return* failures so the type system makes the
  exit-1 path explicit at every call site (Rust's `main() -> Result`
  convention). Trigger: enough catch-site narrowing pain to make the
  ergonomics worth the API churn. Likely lives as a separate
  `defineResultCli` entry point so the throw-based shape stays
  available.
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
