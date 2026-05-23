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
revert of `a9a32c1`) because this list became visible *during* the
ceremony. Anything here would force a v2 if it landed post-1.0; SemVer
treats them as breaking, so they have to ship first.

- **Discriminated `discovery.plugins[]` use-key.** Today `use:` is
  overloaded: a path-like string (`./examples/plugins/deno`) means
  a local plugin; a bare name (`cargo`, `npm`) means an official
  first-party plugin from the registry (none ship in v1, but the
  resolution code already branches on this string-shape heuristic).
  The intent is clear at sites where it's written, but parsers
  can't tell from the YAML alone what kind of reference it is.
  Borrow GitHub Actions' shape: separate keys (`path:` for local,
  `builtin:` or `registry:` for official, possibly `executable:`
  for "any binary on PATH" later) so the discriminator is explicit
  in the source and lossless through Zod → JSON Schema. Migration
  story: detect the old shape, emit a one-time warning pointing at
  `dv migrate config` (which itself doesn't exist yet — call that
  command's design work part of this thread).

### Commands still to implement

These are spec'd in [specs/cli.md](specs/cli.md) as v1 commands — not
deferred, just not built yet. Listed here so they don't get lost
between milestone-class pieces of work.

- **`dv rename <from> <to>`** — append a lineage edge to the rename
  ledger so an old name resolves to a new one. Pure bookkeeping;
  never touches the package itself.
- **`dv plugin invoke <plugin> <op>`** — single-Op debugger for
  plugin authors. Sets up the env vars, pipes stdin, prints stdout.
- **`dv plugin verify <plugin>`** — conformance check against
  `specs/schemas/plugin-responses.json` per Op the plugin declares.
- **`dv migrate config`** — one-shot rewriter that takes the
  pre-1.0 `use:` shape (string-overloaded) and rewrites it to the
  post-redesign discriminated form. Not in `specs/cli.md` yet;
  added to this list because the use-key redesign needs a
  migration path.

Done: `dv v1 <package>` (commit `06cc1de`). Not yet exercised against
`@seshat/dv` itself — see the breaking-changes section above.

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
