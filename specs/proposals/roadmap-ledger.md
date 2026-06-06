# Proposal: Roadmaps as a ledger (v2)

> **Status: proposal, not authoritative.** This drafts the vocabulary and
> algebra for roadmap entries so we can judge whether the abstraction holds
> *before* writing any code or touching [language.md](../language.md). When
> accepted, the Lexicon / Domains / Operations / Algebra / Forbidden-synonyms
> sections below fold into `language.md` verbatim, and the schema stubs become
> real files under `specs/schemas/`. Until then, nothing here binds the
> implementation.
>
> Tracks [ROADMAP.md #26](../../ROADMAP.md). Builds on
> [design.md § Deferred to v2: roadmaps](../design.md#deferred-to-v2-roadmaps).

---

## The shape of the decision

A roadmap manager belongs **inside `dv`**, as a second concrete instance of
the same paradigm that produces the CHANGELOG: tracked Markdown files with
YAML frontmatter, aggregated into a generated document. Changelog covers what
shipped; roadmap covers what's coming. **The release boundary is the temporal
seam** — and that seam is the entire reason it lives in `dv` rather than a
sibling project: only `dv` observes, mechanically, the moment planned work
ships.

Two layers, borrowed from how GitHub Issues reproduces heavyweight workflows
from a tiny fixed core:

1. **A fixed algebraic core** — the part `dv` reasons about. For a Record this
   is `(Change Type, Packages)`; for a Roadmap Entry it is its lifecycle
   **Status** with one privileged terminal, `Shipped`. This core is *not*
   user-configurable, for the same reason the Change-Type vocabulary isn't:
   the correctness laws depend on it being a small fixed set.
2. **A configurable descriptive layer** — additive, algebra-**inert**
   metadata declared in `.dv/config.yaml` (entry types, editorial states,
   custom fields). This is the "issue types + custom fields" surface that lets
   teams model epics/stories/spikes and Azure-DevOps-style boards *without
   forking the engine*. It generalizes the Record's existing `links` / `notes`
   fields.

The discipline is: **anything the algebra reads is fixed; everything else is
the user's to shape.**

---

## Lexicon (additions to language.md)

**Ledger** — the abstraction with two concrete instances: the **changelog**
(Records → CHANGELOG, covering what shipped) and the **roadmap** (Roadmap
Entries → ROADMAP, covering what's planned). They share frontmatter parsing,
aggregation, and the per-Package model; they have independent lifecycles.
*Introduced only now that a second instance exists — not preemptively.* *Not:
journal, log.*

**Roadmap Entry** — a tracked account of *planned* work: a Status, an
optional set of associated Packages, optional Fulfillment links to the
Records that will close it, a user-configurable Entry Type and custom Fields,
and a Markdown body. Lives as one file in `.dv/roadmap/`. The forward-looking
sibling of a Record. *Not: issue, ticket, task, item, todo.*

**Status** — a Roadmap Entry's lifecycle position. Exactly one value is
privileged and fixed: **`Shipped`**. All other values are user-configured
editorial states (e.g. `proposed`, `accepted`, `in-progress`, `dropped`). The
non-`Shipped` states have no algebraic meaning — they are descriptive, like
priority. *Not: state (in user-facing text — reserved for the privileged
sense), stage, phase.*

**Fulfillment** — a declared link from a Roadmap Entry to the Record(s) that
realize it (`fulfills:` on the Record, or `closes:` on the Entry — direction
TBD, see Open questions). The roadmap analog of a Rename edge: an explicit,
never-guessed relationship. *Not: closes-link (in spec prose), resolves.*

**Entry Type** — a user-declared classifier on a Roadmap Entry (e.g. `epic`,
`story`, `spike`), drawn from `roadmap.entryTypes` in config. Purely
descriptive; the algebra never reads it. The direct analog of a GitHub issue
type. *Not: kind, category (those are taken by Change Type's forbidden list).*

**Field** — a user-declared, algebra-inert metadata slot on a Record or
Roadmap Entry, defined in config (name, type, optional enum values, required
flag). Generalizes the Record's built-in `links` / `notes`. Rendered into the
generated document; never an input to any Operation in the algebra. *Not:
property, attribute, column.*

---

## Domains (additions)

```
Status      = { Shipped } ∪ EditorialStates
EntryType   = config-declared finite set (roadmap.entryTypes)
FieldName   = config-declared identifiers
FieldValue  = string | enum-member | … (per the field's declared type)

EditorialStates = config-declared finite set (roadmap.states), Shipped ∉ it
```

`Status` has exactly one fixed, privileged member, `Shipped`. `EditorialStates`
is whatever the user configures; the algebra is parametric over it but reads
**only** the `Shipped` / ¬`Shipped` distinction — never a specific editorial
value. This is the formal statement of "only `Shipped` is load-bearing."

Crucially, `Status` is **not a chain** and Roadmap Entries do **not**
aggregate into a Bump. A Roadmap Entry is forward-looking; it carries no
Change Type and produces no Version increment. (When it ships, the *Record*
that fulfills it carries the Change Type and drives the Bump, through the
existing changelog algebra — unchanged.)

---

## Operations (additions)

```
discoverEntries  : Config → 𝒫(RoadmapEntry)
fulfilledBy      : RoadmapEntry × 𝒫(Record) × Tags → Bool
status           : RoadmapEntry × RepoState → Status
renderRoadmap    : 𝒫(RoadmapEntry) → ROADMAP
validateFields   : Config × (Record ∪ RoadmapEntry) → Ok ∪ FieldError
```

### status — the induced lifecycle

`Shipped` is **not** a hand-edited field. It is *induced* by the release
boundary, exactly as released-ness is induced by Tags
([language.md Algebra §4](../language.md#4-release-is-tag-defined-statelessness)):

```
status(e, state) = Shipped              if fulfilledBy(e, Records(state), Tags(state))
                 = e.editorialStatus    otherwise   (the user-set value, default first config state)
```

```
fulfilledBy(e, records, tags) ≡
    ∃ r ∈ records linked to e via Fulfillment
    such that every Package of r is released?  (its (Package, Version) ∈ tags)
```

In words: an Entry is `Shipped` the moment a Record that fulfills it has
actually been released (its tag exists). No status field to forget to flip;
the changelog defines shipped-ness the way Tags define released-ness.
`validateFields` runs the config-declared schema over both Records and Roadmap
Entries at parse time (Zod), rejecting unknown or malformed fields — the
descriptive layer is validated but never fed to the algebra.

---

## Algebra (additions — laws the roadmap half must hold)

### R1. The two ledgers are decoupled — the roadmap induces no Bump

```
aggregate (the changelog's 𝒫(Record) → (Package ⇀ Bump)) ignores 𝒫(RoadmapEntry) entirely.
```

A Roadmap Entry never contributes to a Version increment. The changelog
algebra ([§1–§3](../language.md#algebra)) is **unchanged** by this proposal.
This is the formal guarantee that adding roadmaps cannot destabilize SemVer or
the bump proofs: the roadmap is additive, off to the side.

### R2. Shipped-ness is release-defined (the roadmap's §4)

```
status(e) = Shipped  ⟺  ∃ fulfilling Record r with released?(every Package of r)
```

The privileged terminal lives in the same place as release state — Records +
Tags — not in a mutable status field. Mirrors
[§4 statelessness](../language.md#4-release-is-tag-defined-statelessness):
the roadmap keeps **no** independent "is it done" state.

### R3. Idempotence

```
renderRoadmap ∘ renderRoadmap = renderRoadmap     (regeneration with no entry changes is a no-op)
```

Mirrors [§5](../language.md#5-idempotence): re-rendering the ROADMAP with
nothing new is a no-op, not an error.

### R4. Fulfillment is declared, never guessed

Like Renames ([§8](../language.md#8-rename-resolution-is-transitive-closure)),
the Record↔Entry link is an explicit declaration. `dv` never infers that a
Record fulfills an Entry from text, titles, or heuristics. A Fulfillment link
to a vanished Record/Entry is an **Unresolved Reference** (reusing the existing
neutral term and halt-behavior), not a silently dropped edge.

### R5. The configurable layer is algebra-inert

```
For every Operation O in the algebra and every Record/Entry x:
    O(x) is independent of x's Entry Type and custom Fields.
```

Entry Types and Fields can be added, removed, or restructured in config with
**zero** effect on any Bump, Status, or Plan. This is the formal license for
user-configurable schemas: they cannot change what `dv` *does*, only what it
*records and renders*. The property test is: mutate any field/entry-type value,
assert every Operation's output is unchanged.

---

## Forbidden synonyms (additions)

| Concept                       | Use            | Never                                   |
| ----------------------------- | -------------- | --------------------------------------- |
| Planned-work entry            | Roadmap Entry  | issue, ticket, task, item, todo         |
| Two-instance abstraction      | Ledger         | journal, log                            |
| Entry lifecycle position      | Status         | state (user-facing), stage, phase       |
| Record↔Entry realization link | Fulfillment    | closes-link, resolves                   |
| User classifier on an Entry   | Entry Type     | kind, category                          |
| User-declared metadata slot   | Field          | property, attribute, column             |

`Ledger` is reserved for *this* abstraction and must not be confused with the
**rename ledger** (`.dv/renames.yaml`), which keeps its established name; if
the collision proves confusing in practice, rename the file-level concept
rather than overloading `Ledger`.

---

## Configurable schema sketch (config-format.md addition)

```yaml
# .dv/config.yaml
records:
  fields:                       # algebra-inert metadata on Records (extends built-in links/notes)
    severity: { type: enum, values: [low, high, critical] }
    team:     { type: string }

roadmap:
  entryTypes: [epic, story, spike]              # GitHub-issue-types analog; descriptive only
  states:     [proposed, accepted, in-progress, dropped]   # editorial; Shipped is implicit + privileged
  fields:
    estimate: { type: enum, values: [S, M, L, XL] }
    target:   { type: string }                  # e.g. a milestone name
```

- `roadmap.states` lists **editorial** states only. `Shipped` is always
  present, always privileged, and may not be redeclared or removed.
- `records.fields` / `roadmap.fields` are validated with Zod at load time
  (per the project's config-validation discipline). Unknown frontmatter keys
  on an entry are an error, exactly as `record.json` sets
  `additionalProperties: false` today.
- Nothing under `records` may add a field the algebra reads. The Record's
  `type` / `packages` core stays exactly as in
  [record.json](../schemas/record.json).

---

## Why not a separate project (recap)

- The seam (`Shipped` ⟺ released fulfilling Record) is only observable inside
  `dv` — a sibling tool would re-implement discovery, tag-reading, and the
  release state machine to get it.
- Shared frontmatter/aggregation infrastructure means one engine, two
  instances — splitting forces either duplication or a premature shared core.
- Record↔Entry cross-reference is cheap in-process, brittle across tools.

It re-opens **only** if roadmaps grow a storage/state model fundamentally
unlike Records, or accrete heavy PM opinion (boards, assignees, sprints) that
pulls `dv` toward being a project-management tool. If that happens, spin out
the *opinionated layer* and keep the Ledger primitive in `dv`.

---

## Resolved questions

These were the open threads from the first draft. Each is resolved by reusing
an existing `dv` durability pattern rather than inventing new state. The
guiding observation: `dv` already keeps three durable, declared, append-only
stores — **Tags** (release state, Algebra §4), the **rename ledger** (lineage,
§8), and the per-Package **CHANGELOG** (shipped history). A Record, by
contrast, is *deliberately* ephemeral: consumed at `dv version`, random slug,
"`dv` ignores the filename." So no durable link may terminate on a Record; the
durable endpoints are the **Entry** and the **Tag/CHANGELOG**.

### Q1 + Q2 — Entry identity, and how Fulfillment survives Record consumption

These are one problem: a Fulfillment edge must outlive the Record that
declares it, so it has to be anchored to durable identity on both ends.

**Q2 — Entry identity: a stable frontmatter `id`.** Each Roadmap Entry carries
a required `id` — a meaningful, durable slug (e.g. `oauth-device-flow`),
unlike a Record's throwaway random filename. The `id` is the Entry's identity
across its (long) lifetime, the rename-stable target of Fulfillment, and the
key the generated ROADMAP groups by. `id` is immutable once assigned; renaming
an Entry is a new `id` plus a redirect (deferred — Entries rename far less than
Packages, and YAGNI until asked).

**Q1 — Fulfillment is declared on the Record, stamped onto the Entry at
version time.** This mirrors the rename ledger exactly: an ephemeral
declaration is promoted into a durable append-only edge.

- **Authoring side (ephemeral):** a Record declares `fulfills: [entry-id, …]`.
  Natural — the author knows which planned work the change closes as they write
  the Record. This is a `Field`-like reference, but it *is* algebra-relevant
  (it feeds `fulfilledBy`), so it is a first-class Record field, not a config
  custom field.
- **Promotion at `dv version`:** before the Record is consumed, `dv` resolves
  each `fulfills` id and **appends a Fulfillment edge to the named Entry's
  frontmatter** — `fulfilledBy: [{ record: <headline/slug>, packages: [...],
  at: <version-being-cut> }]`. The Record then gets consumed as usual; the edge
  survives on the durable Entry. (`at` is unknown until the bump is computed,
  so promotion happens inside `dv version`'s plan-execute, alongside CHANGELOG
  writes — and is previewed by `--dry-run` / `dv status` like every other
  mutation, per Plan determinism §7.)
- **Why the Entry, not a tag annotation or a new ledger file:** the Entry is
  already a tracked file we persist and render; the edge belongs with the thing
  it describes. A tag annotation is possible (R2 only needs the Tag to *exist*
  to flip `Shipped`), but the `fulfilledBy` edge carries richer provenance
  (which Record, which version) that the ROADMAP renderer wants, and keeping it
  in frontmatter makes it greppable and diff-reviewable. No new top-level state
  file is introduced.
- **Direction, settled:** Record → Entry (`fulfills`), promoted to Entry-side
  `fulfilledBy`. The Entry never hand-references a Record (Records are
  ephemeral; such a link would dangle the moment the Record is consumed).
- **Dangling `fulfills`:** a `fulfills` id matching no Entry is an **Unresolved
  Reference** (reusing the §8 term + halt behavior); `--prune` drops it, same
  as a vanished Package reference.

This updates the `status` Operation: `fulfilledBy(e, …)` now reads the Entry's
promoted `fulfilledBy` edges (each pointing at a `(Package, Version)`) and
checks those Tags — it no longer needs the (gone) Records at status time.

### Q3 — `Shipped` granularity for multi-Package Entries: configurable, default *any*

The default is **`any`**: an Entry is `Shipped` once *any* fulfilling Record's
Packages are released. This matches the common case (an Entry is a unit of
planned work; the first shipped Record that fulfills it is "done enough" to
move it off the roadmap) and keeps R2 simple.

A stricter **`all`** mode (Entry is `Shipped` only when every Package it
*associates* has a released fulfilling Record) is offered as a
**config knob**, `roadmap.shippedWhen: any | all` (default `any`) — because
this is a genuine editorial-policy choice, not an algebraic invariant, so it
belongs in the configurable layer. Note this knob is *not* algebra-inert in
the R5 sense (it changes `status`), so it is an explicit, enumerated,
algebra-*known* option — the one sanctioned exception, the same way
`shippedWhen` parallels how `safety.dry-run-by-default` is a known behavioral
switch rather than free-form metadata. Custom `Fields` remain fully inert;
only this one enumerated policy switch touches the algebra.

R2 restated with the knob:

```
status(e) = Shipped  ⟺  shippedWhen = any  ∧  ∃ fulfilling Record fully released
                     ∨  shippedWhen = all  ∧  every associated Package has a released fulfilling Record
```

### Q4 — Rendering: a `roadmap` Subtool + `dv roadmap` command family

Settled: a new **roadmap** Subtool (joining discovery / records / versioning /
changelog / tagging / publishing) with a `dv roadmap` command family —
`dv roadmap add`, `dv roadmap status`, `dv roadmap render` — parallel to how
records + changelog relate. The two ledgers stay **loosely coupled**
(design.md's stated model): `dv version` does the *one* cross-ledger action it
must (promote `fulfills` → `fulfilledBy` before consuming Records), but ROADMAP
rendering is its own command, not a side effect of `dv version`. This keeps the
release pipeline's algebra untouched (R1) and lets teams regenerate the roadmap
without cutting a release. `dv roadmap status` is the roadmap analog of
`dv status`: a read-only Plan-shaped preview of which Entries would flip to
`Shipped`.

### Q5 — Field type system: a minimal Zod-expressible subset, no new schema language

Start with `string`, `enum` (with `values`), `bool`, and `number` — the subset
that covers issue-tracker custom fields and maps 1:1 onto Zod (the project's
config + stdio validation substrate). No nested objects, no cross-field
constraints, no expression language in v2; if a real need appears, widen the
subset deliberately. Field definitions live under `records.fields` /
`roadmap.fields`, are compiled to Zod at config load, and validate entry
frontmatter at parse time — unknown keys rejected, exactly as `record.json`'s
`additionalProperties: false` does today.

---

## Still open (genuinely deferred, not blocking the vocab fold-in)

- **Entry rename / redirect.** Immutable `id` + a redirect mechanism if Entries
  ever need renaming. Deferred (YAGNI; Entries rename rarely).
- **Aggregate / root ROADMAP** across Packages, mirroring the deferred
  aggregate root CHANGELOG.
- **Cross-`fulfills` to *external* trackers** (a GitHub issue URL as a
  fulfillment target) — out of scope; `dv` doesn't integrate external services.
