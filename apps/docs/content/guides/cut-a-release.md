# Cut a release

This guide walks through running a real release end-to-end, including
the things you'll actually do in practice — previewing first, handling
failures, and (if your team wants it) gating the bump on review. If
you've never used dv, start with the
[Getting started tutorial](/getting-started) first; this assumes you
already know what Records are.

Skim the page top-to-bottom the first time. After that, the **TL;DR**
at the top is what most days look like.

The default workflow is **release-on-merge** (plain GitHub Flow):
merging a feature PR to `main` runs both phases automatically, because
the bump is derived from the Records that PR carried. Teams that want a
human to approve the bump before it lands can route the `dv version`
commit through a **Release PR** instead — same two commands, one extra
review gate. This guide shows release-on-merge first, then the Release
PR variant.

## TL;DR

```sh
# 1. Verify the plan
$ dv status

# 2. Bump versions + write CHANGELOGs
$ dv version --dry-run    # preview
$ dv version              # for real (one commit, straight to main
                          # under release-on-merge)

# 3. Tag + publish
$ dv release --dry-run    # preview
$ dv release              # for real
```

Three commands, two phases. Under release-on-merge both phases run in
CI on merge to `main`; if you gate behind a Release PR, the `dv version`
commit is reviewed and merged before `dv release` runs. The rest of this
page is the *why* and the edge cases.

## Step 1: see what's pending with `dv status`

Before you do anything destructive, check what dv would do:

```sh
$ dv status

Pending Records — 3 records, 2 packages (run `dv version`):
  @my/api       1.2.3 → 1.3.0    minor  (2 feat, 1 fix)
       └ would update dependents: @my/client
  @my/client    0.4.0 → 0.5.0    minor  (1 feat)

Awaiting release — 1 package (run `dv release`):
  @my/utils    2.1.0  would tag @my/utils@2.1.0

Tracked packages — 3 total:
  @my/api      1.2.3  packages/api
  @my/client   0.4.0  packages/client
  @my/utils    2.1.0  packages/utils
```

What this is telling you:

- **Pending Records** — there are 3 Records in `.dv/records/` that
  would consume into 2 package bumps. `@my/api` gets `minor` (max of
  one `feat` + one `fix`, plus another `feat`); `@my/client` gets
  `minor` (one `feat`). The cascade would also rewrite `@my/client`'s
  constraint on `@my/api`.
- **Awaiting release** — `@my/utils` is at `2.1.0` in its manifest
  but has no `@my/utils@2.1.0` git tag yet. `dv release` would mint
  it. (This could happen if someone hand-edited a manifest, or if a
  previous `dv release` failed mid-flight.)
- **Tracked packages** — every package dv discovered, with its
  current version. Useful as a sanity check after config changes.

If the pending plan looks wrong (a bump you didn't expect, a package
you didn't intend to bump), stop here and inspect `.dv/records/`. The
Records are the source of every bump; if the bump looks wrong, a
Record is the cause.

## Step 2: preview with `--dry-run`

`dv status` shows what `dv version` *would* do, but it doesn't show
the full Plan (the byte-for-byte JSON or the human-readable Plan
that the real command would execute). For that:

```sh
$ dv version --dry-run

Plan (dry-run):
  @my/api 1.2.3 → 1.3.0 (minor)
       └ would update dependents: @my/client
  @my/client 0.4.0 → 0.5.0 (minor)
```

This output is **byte-identical** to what the real run will execute.
The same plan-building code that produced this preview powers the
real version pass — there's no separate dry-run path that could drift
(see [Two-phase release](/concepts/two-phase-release) for the why).

For automation, add `--json`:

```sh
$ dv version --dry-run --json | jq '.pending[] | {package, projectedVersion, bump}'
{ "package": "@my/api",    "projectedVersion": "1.3.0", "bump": "minor" }
{ "package": "@my/client", "projectedVersion": "0.5.0", "bump": "minor" }
```

The `--json` shape is documented in the [Plan schema](https://github.com/ben-laird/dv/blob/main/specs/schemas/plan.json)
and is stable across the three commands (`dv status`, `dv version
--dry-run`, `dv release --dry-run`).

## Step 3: bump versions with `dv version`

```sh
$ dv version

✓ versioned 2 packages, committed a1b2c3d
  @my/api 1.2.3 → 1.3.0 (minor)
  @my/client 0.4.0 → 0.5.0 (minor)
  ↳ updated 1 dependent constraint (@my/client)
  ↳ refreshed 1 file (deno.lock)
```

What dv did:

1. **Read versions** from each discovered package's manifest.
2. **Built the Plan** (same as the dry-run).
3. **Wrote the new versions** to each bumped manifest.
4. **Prepended CHANGELOG entries** (and HISTORY entries, if
   `history.enabled: true`).
5. **Cascaded constraint updates** — `@my/client`'s `^1.2.3` on
   `@my/api` became `^1.3.0`.
6. **Deleted the consumed Records.**
7. **Refreshed lockfiles** via the plugin's `finalize` op.
8. **Staged everything** into one commit.

Under **release-on-merge**, this commit lands on `main` as part of the
CI job that ran on the merge — there's no separate step. If you prefer
to gate the bump on review, that same commit becomes a **Release PR**:
open it as a PR, review it, and merge it before `dv release` runs (see
[the Release PR variant](#the-release-pr-variant) below).

### What to review (either workflow)

Whether the bump commit lands automatically or you review it as a
Release PR, these are the things worth a look:

- **The CHANGELOG entries** read as you'd want them to. Each Record's
  `notes` field became one CHANGELOG bullet. If the bullet reads
  poorly, you can edit the CHANGELOG in a follow-up commit on the
  same PR — there's no separate "edit CHANGELOG" command, just
  normal markdown.
- **The version bumps match expectations.** A `feat` should produce
  `minor`; a `fix` should produce `patch`. A breaking change marker
  (`feat!`/`fix!`) in a Stable package should produce `major`.
- **Lockfiles refreshed cleanly.** No spurious unrelated changes; no
  resolution conflicts. If a lockfile diff looks weird, the plugin's
  `finalize` op is the place to look.
- **No unexpected packages bumped.** Discovery returned the right
  set — eyeball the `tracked` list in `dv status` before running
  `dv version` if you've recently added or moved packages.

### `--no-commit`: stage without committing

If you'd rather review the working-tree state before committing
(useful in CI flows that have separate "compute" and "commit" steps):

```sh
$ dv version --no-commit
# changes are staged in the index; no commit was made

$ git diff --cached --stat
# inspect…

$ git commit -m "$(your custom message)"
```

This overrides `git.auto-commit: true` for one run.

### `--prune`: drop Unresolved References

If a Record points at a package dv can't find (the package was
deleted, or renamed without a `dv rename` edge), `dv version` halts:

```sh
$ dv version
dv error[unresolved-reference]: 1 record references a Package not found
  — pass --prune to drop them, or use `dv rename` to record the lineage
```

Two recovery paths:

```sh
# Option A: record the rename
$ dv rename @my/old-name @my/new-name
$ dv version

# Option B: drop the stale Record
$ dv version --prune
```

`--prune` is the right call when the Record references a name that
was a typo, or a package that's genuinely gone. `dv rename` is the
right call when a package was renamed and old Records should resolve
to the new name. See [Packages and plugins](/concepts/packages-and-plugins)
for more on the rename ledger.

## Step 4: how the bump reaches `main`

After `dv version`, the manifests and CHANGELOGs are committed; the git
tags don't exist yet. How that commit gets to `main` is your team's
call — dv works the same either way.

- **Release-on-merge (default).** The `dv version` commit is produced by
  the CI job running on merge to `main`, so it's already on `main` — the
  feature PR you merged *was* the review. `dv release` runs next in the
  same job. There's no second PR. See the
  [CI integration guide](/guides/ci-integration) for the workflow.
- **Release PR (variant).** If you want a human to approve the bump
  itself, route the `dv version` commit through a PR — see below.

### The Release PR variant

Some teams want the version bump and CHANGELOG reviewed before anything
is tagged. To do that, run `dv version` so its commit lands on a branch,
open that branch as a PR, and merge it before running `dv release`:

```sh
$ dv version              # one commit on a release branch
# → open as a PR, review the bump + CHANGELOG, merge to main
$ dv release              # only after the Release PR merges
```

The commit `dv version` produces is the **Release PR** in this workflow.
Nothing dv-specific happens at merge time — whatever your team's PR
workflow is (review, approval, merge button) applies. Once it merges to
`main`, proceed to `dv release`. (`--no-commit`, below, is handy if you
want to shape the commit yourself before opening the PR.)

## Step 5: tag + publish with `dv release`

```sh
$ dv release --dry-run

Plan (dry-run):
  mint  @my/api@1.3.0
  mint  @my/client@0.5.0
  mint  @my/utils@2.1.0
  release: 3 publish ops would run
```

For real:

```sh
$ dv release
About to release 3 packages. Continue? [y/N] y

✓ minted 3 tags
  @my/api@1.3.0
  @my/client@0.5.0
  @my/utils@2.1.0
(release plugin invoked for each — see plugin output)
```

What dv did:

1. **Read versions** from each manifest.
2. **Computed the awaiting-release set** — every `(package,
   version)` with no matching git tag.
3. **Minted tags** with the configured format
   (default: `{package}@{version}`).
4. **Fired each package's `release` plugin op** — that's where
   publishing actually happens.
5. **Optionally pushed tags** (`--push` or `git.auto-push`).

The release state is in the tags. Re-running `dv release` after this
is a no-op — every current version has a matching tag.

### `--push` vs. `--no-push`

By default, `dv release` mints tags locally and **does not push** them.
You'd push manually (`git push --tags`) or via CI. To push as part of
the release:

```sh
$ dv release --push
```

Or set `git.auto-push: true` in `.dv/config.yaml` to make this the
default. The flag always overrides the config setting per-run.

The push-sequence (config: `git.push-sequence`) controls when the
push happens relative to the publish ops:

- `publish-then-push` (default) — publish first; only push tags if
  every publish succeeded. Safer: a failed publish doesn't leave a
  pushed tag that can never be re-published.
- `push-then-publish` — push tags first; then publish. Useful if your
  publish op depends on the tag being visible upstream.

### Handling a partial-failure

Publishing is the part most likely to fail (npm registry hiccup,
network blip, auth issue). When one package's `release` op fails:

```sh
$ dv release
✓ minted 3 tags
  @my/api@1.3.0
  @my/client@0.5.0
  @my/utils@2.1.0
✗ @my/api@1.3.0: publish failed (npm error: 503)
✓ @my/client@0.5.0: published
✓ @my/utils@2.1.0: published

dv error[release-partial-failure]: 1 of 3 package(s) failed to publish
  hint: rerun `dv release --force` after addressing each sub-error
        (tags are already in place)
```

A few important things to know:

- **Tags are NOT rolled back on publish failure.** Tags are the
  release state; rolling them back would mean the next run would
  re-mint them, possibly with different content. Better to leave the
  tag and let the user fix forward.
- **The exit code is non-zero** so CI fails loudly. The `--json`
  envelope (`release-partial-failure`) lists every failed package so
  automation can dispatch follow-ups.
- **`dv release --force` retries everything**, including
  already-tagged packages. That's what you want for the "publish was
  the only thing that failed" case — the tag is already there, but
  the publish op needs to re-run.

### `--force`: re-publish already-tagged packages

```sh
$ dv release --force
```

`--force` re-runs the `release` op for every package, regardless of
whether its tag exists. No new tags are minted (they're already
there); the publish ops just fire again.

Use cases:

- Publish failed; the registry is recovered; you want to retry.
- You want to re-trigger a downstream effect of the release op (e.g.
  notifying a chat channel, kicking off a deploy).
- The publish op was changed and you want it to apply to a previous
  release.

## What's next

- **[Promote to 1.0](/concepts/semver-and-stability#dv-v1-is-the-only-escape-hatch)** —
  the one bump that's not in this flow.
- **[Troubleshooting](/reference/troubleshooting)** — common errors and
  how to recover from them.
- **[CLI reference](/reference/cli)** — every flag for every command.
