# Why dv?

`dv` exists because changelogs and SemVer are easy to specify, hard to
operationalize, and everyone keeps building the same workaround. This
page lays out the design bets and contrasts `dv` with the closest
alternatives, so you can decide whether it fits.

## The problem

Two patterns dominate how teams manage versioning today.

**Conventional Commits parsing** — tools read commit messages, classify
them as `feat`/`fix`/`feat!`, and derive a bump. This makes the commit
message a load-bearing artifact and turns every PR into a style fight.
A commit hook rejects `add stuff`. A linter rewrites it. CI fails because
the rebase squashed the wrong subject line. The release tooling is
correct in principle and exhausting in practice.

**Changesets-style flows** — contributors author a small file declaring
the change. This solves the style fight but ships as a tightly-coupled
npm tool. Other ecosystems either don't have an equivalent, or have an
equivalent that doesn't quite work the same way, and the gap between
"changesets in our JS monorepo" and "ad-hoc bash in our Rust monorepo"
is a real cost.

In both cases, the *idea* is right. The execution is incomplete.

## What dv bets on

### Records, not commit messages

A **Record** is a small Markdown file with frontmatter:

```markdown
---
type: feat
packages:
  - "@my/api"
notes: add /v2 endpoint with pagination
---

Add /v2 endpoint with pagination
```

Contributors author one alongside the code change. `dv` reads Records;
it never parses git commit messages. Your commit messages can say
whatever you want — `chore: thing`, no message, an essay, an emoji.

The bet: **declaring intent in a tracked file is strictly better than
inferring it from commit messages**. The file is reviewable in the PR.
It's diff-able. It survives squash merges. It doesn't need a parser
that everyone's CI fights with. And it preserves the *author's intent*
rather than whatever the commit hook coerced their message into.

Teams already writing Conventional Commits keep doing so; nothing
changes for them. Teams that don't lose nothing — the discipline lives
in the Record format, not in commit-message hygiene.

### Plugins are executables

`dv` doesn't ship a Node SDK, a Rust crate, or a Python package as the
"right" way to extend it. The contract is **JSON over stdio against any
executable**. The OS routes to the right interpreter via the shebang.

```sh
$ my-plugin discover < /dev/null
{"packages": [{"name": "@my/api", "path": "packages/api"}]}
```

That's the whole interface. Read [the plugin contract](/reference/plugin-contract)
for the per-operation shapes.

The bet: **the right extension surface for a tool that spans ecosystems
is the lowest-common-denominator process boundary**. A Rust shop writes
a Rust plugin; an npm shop writes a Node plugin; a polyglot monorepo
writes one per language. None of them depend on `dv` being implemented
in their preferred language, and none of them have to fight a host-
language SDK's opinions.

This shows up downstream: `dv` has no first-party plugins in v1. We
ship [copyable example plugins](https://github.com/benlaird0/dv/tree/main/examples/plugins)
(currently `deno` and `npm`) as starting points, but they're not
maintained dependencies. You fork one, adapt it, and own it. Promoting
an example to a supported builtin is a deliberate future decision, not
a default.

### Dry-run is first-class

Every destructive command in `dv` accepts `--dry-run` and emits a
complete preview with **zero side effects**. The same plan-building
code runs in both paths — there's no separate "dry-run mode" that could
drift.

```sh
$ dv version --dry-run
Plan (dry-run):
  @my/api 0.1.0 → 0.2.0 (minor)
       └ would update dependents: @my/client
```

Combine that with `--json` and you have a stable, versioned machine
format suitable for any orchestration layer — shell, CI, AI agent,
whatever. The automation surface is identical for humans and machines;
there's no privileged tier.

The bet: **plan-then-execute is the only safe shape for destructive
multi-package operations**. The plan is data; you can inspect it,
diff it, gate on it, replay it. Tools that don't expose this make
their users guess.

### Strict SemVer with one explicit escape hatch

`dv` is opinionated about exactly one thing: SemVer.

- **Pre-1.0 packages** can never accidentally hit `1.0.0`. A breaking
  change in `0.x.y` bumps the minor (capped from major). The algebra
  makes this impossible to violate — see [SemVer and stability](/concepts/semver-and-stability).
- **The `0.x → 1.0` transition is a deliberate command** — `dv v1 @my/api`.
  It's the only operation that crosses the stability boundary, and it's
  treated as a ceremony. (The next `dv release` celebrates the
  first-stable tag with a 🎉.)
- **Records carry a fixed vocabulary** — `feat`, `fix`, `feat!`, `fix!`.
  Non-bump categories (`chore`, `docs`, `refactor`) are deliberately
  absent. Internal churn belongs in git history, not the CHANGELOG.

The bet: **SemVer is a contract with downstream users, not a style
preference**. A versioning tool's job is to make compliance the default
path and violation impossible, not to give teams more knobs.

### Composable Unix primitive

`dv` does one job well. It has no embedded AI, no hosted service, no
account flow, no Slack/GitHub Releases/email integration. The
automation surface (non-interactive flags, `--json`, stable exit codes)
is the only contract it offers, and it's identical for everyone.

AI-driven tooling that *calls* `dv` is welcome and explicitly
encouraged — but it lives in *separate projects*. Not in core.

The bet: **a tool that wants to be universal can't take sides on what
calls it**. Every "smart" feature in core is a future deprecation.

## Comparison

| | dv | Conventional Commits + tool | Changesets |
|---|---|---|---|
| Source of intent | Records | Commit messages | Changeset files |
| Commit-message style enforced | No | Yes (style fight) | No |
| Multi-language | Yes (executable plugins) | Limited | npm-only by default |
| Multi-package monorepo | First-class | Varies by tool | First-class (npm) |
| Constraint cascading | Yes (declarative) | Varies | Yes |
| Two-phase release | Yes (version → release) | Usually one phase | Yes |
| Dry-run with full plan | Yes | Varies | Partial |
| First-party plugins | None in v1 (examples only) | N/A | npm only |
| AI / SaaS lock-in | None | None | None |
| Pre-1.0 protection | Cap is enforced; `dv v1` is explicit | Varies | Varies |

The honest summary: if you're an npm-only shop and Changesets is
working for you, **keep using Changesets**. `dv` doesn't aim to displace
it. `dv` is for the case where Changesets doesn't apply — polyglot
monorepos, non-npm ecosystems, teams that want the model without
inheriting the npm tooling assumptions.

## What dv is *not*

- **Not a replacement for `npm publish` / `cargo publish` / etc.** Those
  happen inside release plugins. `dv` mints tags and dispatches; the
  plugin does the actual publish.
- **Not an opinionated workflow tool beyond SemVer + the Record vocabulary.**
  Branch naming, PR templates, code review process — `dv` has no
  opinions. It runs wherever your CI runs.
- **Not a roadmap tool.** Records are about changes that already
  happened. Tracking planned work in the same shape is a v2 idea (the
  underlying abstraction may earn the name *ledger* with both
  CHANGELOG and roadmap as instances), deliberately deferred.
- **Not a SaaS.** No accounts. No hosted state. The release state is
  git tags; nothing else.

## What dv runs on

`dv` is written in **TypeScript on Deno** today. The implementation
language doesn't matter for users — the binary is what you interact
with. A Rust rewrite is on the table only when cold-start cost is felt,
distribution friction matters, and the API has stabilized enough to
earn the polish. Until then, TypeScript on Deno gives the fastest
iteration loop and lets the contract evolve.

## Ready to try it?

The fastest path is [the five-minute tutorial](/getting-started). After
that, the [Concepts](/concepts/records) pages explain the model, and
[the CLI reference](/reference/cli) is your day-to-day companion.
