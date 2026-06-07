# Ubiquitous Language

This document is the canonical vocabulary of `dv` and the algebra relating
its concepts. It exists to *lock in* the design: every other doc, and the
eventual implementation, uses these terms with exactly these meanings — one
term per concept, no drifting synonyms. The algebra states the invariants
the implementation must preserve.

It is split into four parts: the **Lexicon** (the nouns), the **Domains**
(their value sets), the **Operations** (the functions between them), and the
**Algebra** (the laws those operations obey). A final section lists
**forbidden synonyms** — the discipline that keeps the language ubiquitous.

Notation is light set theory: `𝒫(X)` is the set of subsets of `X`,
`A → B` a total function, `A ⇀ B` a partial function, `⊥` an undefined
result, `⊔` a join (least upper bound), and `a ⊏ b` an ordering.

---

## Lexicon

Each entry gives the **canonical term**, its definition, and — where there's
a tempting wrong word — what *not* to call it.

**Package** — a unit carrying an independent Version, located at a path,
managed by exactly one Plugin. The universal term for what an ecosystem
might call a crate, module, library, or project. *Not: module, project,
crate.*

**Version** — a SemVer triple `(major, minor, patch)`.

**Stability** — which stability regime a Package is in, determined by its
Version: `Unstable` when `major = 0`, `Stable` when `major ≥ 1`. (Names the
previously-implicit pre-1.0 / post-1.0 distinction: `0.x` is *unstable* —
anything may break across any version difference — while `≥ 1.0` carries a
stability contract.) It governs how a Change Type maps to a Bump. *Not: era,
phase, regime, stage.*

**Change Type** — the kind of a single change, drawn from the Conventional
Commits subset `dv` accepts: `feat`, `fix`, `feat!`, `fix!`. The `!`
denotes a breaking change. The vocabulary is borrowed from CC because it
is the lingua franca; `dv` does **not** read commit messages — a Change
Type is declared on a Record, never inferred from git. *Not: kind,
category.*

**Bump** — a SemVer increment level: `patch`, `minor`, `major`. Totally
ordered as `patch ⊏ minor ⊏ major`. *Not: increment, level, severity.*

**Record** — a pending, committed account of one change: a Change Type, a
set of affected Packages, and a Markdown body. Lives as one file in
`.dv/records/`. Called a *Record* (Seshat keeps records) precisely to
avoid confusion with *changesets*, the external tool that inspired the
format. *Not: changeset, change file, entry, note.*

**Plugin** — an executable that bridges `dv` to an ecosystem by implementing
Ops over JSON-on-stdio. *Not: adapter, driver, backend.*

**Op** — a single Plugin operation: `discover`, `read-version`,
`write-version`, `update-dependency`, `release`. *Not: hook, command,
method.*

**Subtool** — one of `dv`'s capability modules: **discovery**,
**records**, **versioning**, **changelog**, **tagging**, **publishing**.
Commands are orchestrations of Subtools. *Not: module (in user-facing
text), service.*

**Tag** — a git tag marking a released `(Package, Version)`. The release
state lives entirely in Tags. *Not: release marker, label.*

**Rename** — a recorded lineage edge `from → to` (with the Version at which
it took effect) in the rename ledger, `.dv/renames.yaml`. *Not:
alias, move.*

**Unresolved Reference** — a Package reference in a Record that resolves to
no current Package — whether because the Package was deleted, renamed
without a ledger edge, or simply mistyped. The neutral name covers every
cause, not just abandonment. *Not: orphan, dangling, missing, broken.*

**CHANGELOG** — the rendered, per-Package history file. The user-facing
output; distinct from the Records that feed it.

**Plan** — the side-effect-free description of what a command would do,
computed before any mutation. The single artifact shared by `dv status`
and `--dry-run`. *Not: preview, diff.*

**Release PR** — the reviewable commit `dv version` produces. One of two
workflows: under **release-on-merge** (the default) it lands on `main`
automatically as part of the merge; routed through a **Release PR** it is
reviewed and merged before `dv release` runs. The term names the commit in
the latter, gated workflow. *Not: version commit (in user-facing text).*

---

## Domains

The value sets the Operations range over.

```
Version    = ℕ × ℕ × ℕ                       -- (major, minor, patch)
Bump       = { patch, minor, major }          -- chain: patch ⊏ minor ⊏ major
ChangeType = { feat, fix, feat!, fix! }
Stability  = { Unstable, Stable }
```

`Bump` is a **chain** (a totally ordered set), which is what lets multiple
Records combine cleanly (see Algebra §1).

`stability` reads a Version's regime:

```
stability(v) = Unstable   if v.major = 0
             = Stable      otherwise
```

---

## Operations

Signatures first, then the two that carry real content.

```
discover         : Config → 𝒫(Package)
stability        : Version → Stability
classify         : ChangeType × Stability → Bump
apply            : Version × Bump → Version
aggregate        : 𝒫(Record) → (Package ⇀ Bump)
resolve          : PackageRef × Ledger → Package ∪ {⊥}
released?        : Package → Bool
plan             : Command × RepoState → Plan
```

### classify — the Change-Type → SemVer mapping

The whole bump-decision surface, in one table:

| Change Type   | `Stable` | `Unstable` |
| ------------- | -------- | ---------- |
| `fix`         | patch    | patch      |
| `feat`        | minor    | minor      |
| `feat!`/`fix!`| major    | minor      |

The `Unstable` column is the `Stable` column with a **cap** at `minor`:
breaking changes do not promote past `minor` while a Package is pre-1.0,
because there is no stability contract to break yet (see Algebra §2–3).

### apply — performing a Bump

```
apply(v, patch) = (v.major,     v.minor,     v.patch + 1)
apply(v, minor) = (v.major,     v.minor + 1, 0)
apply(v, major) = (v.major + 1, 0,           0)
```

---

## Algebra

The laws. These are the invariants the implementation must hold, and the
formal justification for several design decisions.

### 1. Bump aggregation is a join (max)

A Package `P` touched by Records `r₁ … rₙ` receives the Bump

```
bump(P) = ⊔ᵢ classify(type(rᵢ), stability(version(P)))
```

Because `Bump` is a chain, the join `⊔` is `max`. Consequences: three
`fix`es and one `feat` → `minor`; any breaking change (in `Stable`) →
`major`. The join is **commutative and associative**, so the result is
independent of the order Records are processed. This is why `aggregate`
needs no ordering rules.

### 2. `classify` caps in the `Unstable` regime

```
classify(t, Unstable) = cap(classify(t, Stable))
   where cap(major) = minor,  cap(b) = b otherwise
```

Pre-1.0, the mapping is the stable mapping post-composed with a ceiling at
`minor`. This is the formal statement of "0.x is unstable; breaking changes
don't carry major weight yet."

### 3. No Record can produce `1.0.0`

For any Package `P` with `stability(version(P)) = Unstable`,

```
classify(t, Unstable) ⊏ major   for every t
⟹  apply(version(P), bump(P)).major = 0
```

`major` is never in the image of `classify` in the `Unstable` regime, so
`apply` never increments the major component away from `0`. Therefore no
sequence of Records ever yields a `1.0.0`. **This is the proof that `dv v1`
must exist** — the 1.0 transition is unreachable through the normal bump
algebra and requires an explicit, deliberate operation.

### 4. Release is tag-defined (statelessness)

```
released?(P)  ≡  tag(name(P), version(P)) ∈ Tags
```

There is no other release state — no state file. `dv release` mints exactly
the Tags for `{ P : ¬released?(P) }`. A Version that reaches a manifest by
*any* route (including a manual edit or `dv v1`) is released on the next run
iff it has no Tag.

### 5. Idempotence

```
version ∘ version = version      when no Records remain pending
release ∘ release = release      (already-tagged Packages are skipped)
```

Both commands are idempotent at fixed input: re-running with nothing new to
do is a no-op, not an error.

### 6. The pipeline is staged composition through state

Conceptually `release ∘ version`, but the two phases compose *through the
repo's manifest and Tag state*, never through shared in-memory state:

```
version : Records → ΔManifests + ΔCHANGELOGs + Commit
release : Manifests × Tags → ΔTags + Publishes
```

This is why the phases can run back-to-back on merge (release-on-merge) or
be separated by a PR review (the Release PR), and why each is independently
runnable, dry-runnable, and resumable.

### 7. Plan determinism

```
plan(cmd, state)  is a pure function of state,
and executing cmd realizes exactly plan(cmd, state).
```

`dv status` renders `plan`; `--dry-run` prints `plan`; the real run executes
it. Because all three read from the same pure `plan`, they cannot diverge —
the formal content of the plan-then-execute guarantee.

### 8. Rename resolution is transitive closure

`resolve` follows the reflexive-transitive closure of the Ledger's
`from → to` edges:

```
resolve(ref, ledger) = the unique current Package reachable from ref
                        by zero or more Rename edges,
                     or ⊥ (an Unresolved Reference) if none exists
```

So a Record authored under `core` resolves through `core → engine →
runtime` to the present Package. An Unresolved Reference (`⊥`) halts
`dv version` unless `--prune` drops it.

### 9. Cascade is constraint-only (no bump propagation)

A Bump on `P` rewrites the dependency *constraints* that dependents place on
`P`, but does **not** induce a Bump on those dependents:

```
bump is NOT propagated along the dependency graph;
only constraint rewriting is.
```

Deciding whether a dependent is itself now breaking is editorial, left to a
human via a separate Record.

---

## Forbidden synonyms

The discipline that keeps the language ubiquitous: one word per concept,
everywhere — docs, code, CLI output, error messages.

| Concept                    | Use                  | Never                          |
| -------------------------- | -------------------- | ------------------------------ |
| Versioned unit             | Package              | module, project, crate, lib    |
| Pending change record      | Record               | changeset, change file, entry  |
| Increment level            | Bump                 | increment, level, severity     |
| Pre/post-1.0 regime        | Stability            | era, phase, regime, stage      |
| Plugin operation           | Op                   | hook, command, method          |
| Capability module          | Subtool              | service, plugin (for internals)|
| Released-state marker      | Tag                  | release marker, label          |
| Side-effect-free preview   | Plan                 | preview, diff, dry-run output  |
| Unresolvable reference     | Unresolved Reference | orphan, dangling, missing      |

Note that **changeset** is deliberately forbidden for our concept — it is
reserved for referring to *changesets*, the external tool. Our pending
change record is always a **Record**.

When the implementation and the docs disagree on a word, this table wins,
and the disagreement is a bug in whichever drifted.
