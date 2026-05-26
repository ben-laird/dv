# SemVer and stability

dv is opinionated about exactly one thing: SemVer. This page explains
what those opinions are, why pre-1.0 (Unstable) packages can never
accidentally hit `1.0.0`, and how the `dv v1` ceremony works.

If you've used SemVer for a while, much of this will feel familiar.
The dv-specific parts are: the **stability** concept, the pre-1.0
**cap**, and the explicit `dv v1` ceremony.

## SemVer in one paragraph

Every Package has a **version** — a triple `(major, minor, patch)`. A
**bump** raises one component and zeroes the components to its right:

| Bump | Before | After |
|---|---|---|
| patch | `1.2.3` | `1.2.4` |
| minor | `1.2.3` | `1.3.0` |
| major | `1.2.3` | `2.0.0` |

The promise: **a downstream consumer should be able to upgrade across
patch and minor bumps without breakage**. Major bumps signal "you may
need to change your code."

## Stability is a regime, not a property

dv distinguishes two stability regimes, decided entirely by the major
component:

| Stability | Condition | Promise |
|---|---|---|
| **Unstable** | `major = 0` | None — anything can break across any version difference. |
| **Stable** | `major ≥ 1` | The SemVer contract above. |

A package's stability is *implicit in its version number*. There's no
config flag, no opt-in declaration, no "I promise to be stable now."
`0.7.4` is Unstable; `1.0.0` is Stable; that's the entire mechanism.

This matters because the SemVer spec is explicit that **`0.x.y` makes
no promises** — pre-1.0 is the "anything goes" regime. Tools that
quietly produce `1.0.0` as a side effect of normal bumping break that
contract.

## The pre-1.0 cap

Here's the dv-specific rule:

> In the Unstable regime (`major = 0`), no bump can produce a major
> increment.

Concretely:

| Change | Bump in Stable | Bump in Unstable |
|---|---|---|
| `fix` | patch | patch |
| `feat` | minor | minor |
| `fix!` (breaking) | **major** | **minor** (capped) |
| `feat!` (breaking) | **major** | **minor** (capped) |

A breaking change to a pre-1.0 package bumps the *minor* component, not
the major. This means:

- `0.7.4` + breaking change → `0.8.0` (not `1.0.0`)
- `0.9.7` + breaking change → `0.10.0` (not `1.0.0`)

No matter how many breaking changes you make to a `0.x` package, you
will never accidentally reach `1.0.0`.

This is the most opinionated thing dv does. Two reasons it's right:

**It matches the SemVer spec literally.** Section 4 of SemVer: *"Major
version zero is for initial development. Anything MAY change at any
time."* A tool that lets `0.x` slide into `1.0.0` from a routine
breaking change is violating that section.

**It makes the 1.0 promise survivable.** Once you commit to `1.0.0`,
breaking changes mean major bumps and consumer migrations. That's a
real burden. The cap says: *the moment you commit to 1.0 should be a
deliberate decision, not the side effect of a bumpy week.*

## `dv v1` is the only escape hatch

If no normal bump can produce `1.0.0`, how does a package ever reach
it? Through the `dv v1` command:

```sh
$ dv v1 @my/api
About to commit @my/api to 1.0.0 — this is a stability promise.
Proceed? [y/N] y

✓ promoted @my/api 0.7.4 → 1.0.0
  ↳ updated 2 dependent constraints (@my/client, @my/cli)
```

To see which packages in your repo would be candidates for promotion,
run `dv v1 --dry-run` without naming one — that's **catalog mode**, a
discovery aid that lists every `0.x` package with its projected
promotion:

```sh
$ dv v1 --dry-run

Catalog (dry-run): 2 eligible Packages:
  @my/api 0.7.4 → 1.0.0 (first stable!) (3 records)
       └ would update dependents: @my/client, @my/cli
  @my/utils 0.2.0 → 1.0.0 (first stable!) (no pending records)

Promote one with `dv v1 <package>`.
```

Catalog mode is preview-only — there's no bulk-promote. Each
package's 1.0 ceremony is its own deliberate decision.

`dv v1` does everything `dv version` does — consumes Records, projects
the new version, writes manifests, cascades constraints, commits — but
with two differences:

- **The target version is pinned to `1.0.0`.** Not `1.0.0-rc.1`, not
  `1.0.0-beta`, not whatever the algebra would have produced. Exactly
  `1.0.0`.
- **It prompts for confirmation** (or requires `--yes`) because the
  promotion is a stability commitment. Once shipped, no Record type
  can ever take the package back below 1.0.

The constraint cascade rewrites every dependent's constraint to
`^1.0.0` (or your plugin's equivalent), so the rest of the workspace
sees the new stable surface.

The next `dv release` after a `dv v1` celebrates the milestone:

```sh
$ dv release
✓ minted 1 tag
  @my/api@1.0.0  🎉 first stable release
```

The 🎉 fires for every package crossing `0.x → 1.0` for the first
time, computed from tag history.

## When is a package ready for `dv v1`?

There's no formal answer; the answer depends on your consumers. Some
useful heuristics:

- **The public API has been stable for at least one release cycle**
  without breaking changes. If you'd resent a `1.x` consumer for
  expecting that surface to keep working, you're not ready.
- **You have at least one downstream consumer who would notice a
  breakage.** Pre-1.0 is the regime for experimentation; 1.0 is the
  regime for compatibility. If no one's depending on your API yet,
  there's nothing to commit to.
- **The docs match the implementation.** A 1.0 promise is implicitly
  a documentation promise — consumers will read your docs and assume
  the API stays where you described it.

For `dv` itself, none of these are met yet — which is why
`@seshat/dv` is still `0.x`. The cap protects the project from
accidentally shipping a 1.0 that turns out to be wrong.

## Constraint cascading

When a package bumps, dv asks every other discovered package to update
its constraint on the bumped one. The plugin owns the rewrite logic
(it knows how *that ecosystem* expresses constraints), but the rule is
the same everywhere:

| Bumped from | Bumped to | Constraint rewrite |
|---|---|---|
| `0.7.4` | `0.7.5` (patch) | `^0.7.4` → `^0.7.5` (caret preserved) |
| `0.7.4` | `0.8.0` (minor) | `^0.7.4` → `^0.8.0` |
| `1.2.3` | `1.3.0` (minor) | `^1.2.3` → `^1.3.0` |
| `0.7.4` | `1.0.0` (`dv v1`) | `^0.7.4` → `^1.0.0` |

The cascade is **constraint-only** — it rewrites dependents' manifest
*constraints*, not their actual versions. Dependents don't auto-bump
just because a dep bumped; that's an opt-in policy dv deliberately
defers to v2.

Why constraint-only? Because the alternative — auto-bumping every
dependent — gets noisy fast. A patch fix in a low-level package would
cascade into every consumer's CHANGELOG, drowning the actual changes.
The dependent's *manifest* gets updated (which is required for the
constraint to keep matching), but its *version* doesn't bump until
that dependent itself has a Record.

## Idempotence

A few subtle but useful properties:

- **`dv version` with no pending Records is a no-op.** It exits 0 with
  "nothing to version." Safe to run repeatedly.
- **`dv release` with everything tagged is a no-op.** It exits 0 with
  "nothing to release." Safe to bake into CI.
- **Aggregating multiple Records is commutative.** Three `fix`es plus
  one `feat` against the same package produce the same bump regardless
  of order — the algebra is a max-join.

These properties make dv pleasant to run from automation. A flaky CI
job that re-runs `dv release` doesn't double-tag; a developer who runs
`dv version` twice doesn't get a double-bump.

## Things dv won't do

A few deliberate non-features:

- **No `0.x → 1.0` via "just keep bumping breaking changes."** The cap
  blocks it. Use `dv v1` when you mean it.
- **No pre-release tracks in v1** (`alpha`, `beta`, `rc`). The model
  is `0.x` is the pre-release track; the proper SemVer pre-release
  tags are deferred to a future scope.
- **No snapshot / canary releases.** Same reason — out of v1 scope.
- **No "downgrade to a smaller bump" override.** If the algebra says
  `feat` and you wanted `patch`, fix the Record (change its `type`).
  Don't add escape hatches.

These aren't oversights; they're scope decisions to keep the algebra
small enough to reason about.

## Next

- **[Two-phase release](/concepts/two-phase-release)** — how
  `dv version` and `dv release` cooperate around the algebra above.
- **[Records](/concepts/records)** — the source of every bump.
- **[CLI reference](/reference/cli)** — every flag for `dv version`,
  `dv release`, and `dv v1`.
