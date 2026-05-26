# Two-phase release

Most version-bump tools collapse "decide what to release" and "actually
release" into one command. dv splits them: **`dv version` rewrites
manifests and lands a reviewable commit; `dv release` mints tags and
fires publish hooks**. This page explains why the split exists, what
each phase does, and how plan-then-execute keeps both phases honest.

## The two commands

```sh
# Phase 1: consume Records, bump versions, write CHANGELOGs,
#          stage one commit. Reviewable.
$ dv version

# Phase 2: mint per-package git tags, fire each package's release
#          plugin, optionally push tags. Irreversible.
$ dv release
```

In a typical flow:

1. Developers author Records as they make changes.
2. Someone (or CI) runs `dv version` to assemble the **Release PR** —
   one commit containing every manifest bump, every CHANGELOG entry,
   every dependency-constraint rewrite.
3. The Release PR is reviewed and merged.
4. CI (or someone) runs `dv release` on the merged commit, which tags
   each released package and dispatches the publish hooks.

The whole flow is git-native. The Release PR is just a commit. The
release state is just tags. Nothing else.

## Why split

A single-phase release tool has to make tradeoffs:

- If it tags + publishes immediately on bump, mistakes are unrecoverable
  ("I meant to fix the version string before publishing").
- If it bumps, then waits for a separate "go" command, it needs to
  remember its own state ("there's a pending release for package X
  awaiting confirmation").

dv side-steps both. The bump becomes a **reviewable commit** — review
it the way you review any other commit. The "go" signal is **merging
that commit** — the same operation your team already uses for any
change. The release state is **the git tag** — no parallel state file,
no SaaS, no dashboard.

The split also matches how teams actually work:

- **Bumping** is mechanical and benefits from human review (did the
  cascade hit the right packages? does the CHANGELOG read well?).
- **Releasing** is the *event* — once tags are minted and packages are
  published, you can't put the toothpaste back. It deserves its own
  command, its own confirmation, its own audit trail.

## Plan-then-execute

Both phases share an invariant: **the operation is a function of repo
state, computed before any mutation happens.** dv calls this artifact
the **Plan**.

When you run `dv status`, `dv version --dry-run`, or `dv version` for
real, the same code builds the same Plan from the same inputs:

- Discovered packages
- Pending Records (with rename resolution)
- Per-package current versions
- The awaiting-release set (which packages have versions without tags)

The Plan is just data — JSON-serialisable, schema-validated, stable
across the three commands. `dv status` prints it; `--dry-run` prints
it; the real run *executes* it. There is no "dry-run mode" that could
drift from the real path — the dry-run path simply stops after
building the Plan.

This gives you a few useful guarantees:

- **`dv status` cannot disagree with `dv version --dry-run`.** They're
  the same Plan.
- **`dv version --dry-run` cannot disagree with `dv version`.** Same
  Plan; the only difference is whether the Plan is then executed.
- **`--json` on any of the three** emits the Plan in the documented
  schema, so any automation layer can consume it.

For destructive commands, plan-then-execute is the only safe shape.
Anything else is guessing.

## Phase 1: `dv version`

What `dv version` does, in order:

1. **Reads versions** from every discovered package's manifest.
2. **Builds the Plan** — classify each Record, aggregate per package,
   project new versions.
3. **Halts on Unresolved References** — Records pointing at packages
   dv doesn't know — unless `--prune` was passed.
4. **Confirms dry-run mode** — if config or `--dry-run` says preview
   only, render the Plan and exit.
5. **Writes new versions** to each bumped package's manifest (via
   `write-version`).
6. **Renders CHANGELOG entries** and prepends them to each package's
   `CHANGELOG.md`.
7. **Cascades constraint updates** — for each bumped package, asks
   every other discovered package to rewrite its constraint (via
   `update-dependency`). Plugins respond `changed: false` for
   packages that don't carry the dep — that's the no-op path.
8. **Deletes the consumed Records.**
9. **Runs `finalize`** — per plugin, after all writes settle, so
   generated companion files (lockfiles, etc.) refresh in the same
   commit.
10. **Stages everything** and creates one commit.

The result: a Release PR commit. Its diff contains every manifest
change, every CHANGELOG entry, every constraint rewrite, every
refreshed lockfile — and the deletion of the Records that authorised
the whole thing. Review it; merge it; you're done with phase 1.

## Phase 2: `dv release`

`dv release` is **stateless** — there's no state file declaring "these
packages are awaiting release." dv computes that set fresh each run by
comparing each package's current version against existing git tags. A
package needs releasing iff its current version has no matching tag.

What `dv release` does:

1. **Reads versions** (same as `dv version` — discovery + read-version).
2. **Computes the awaiting-release set** — every `(package, version)`
   pair with no matching tag.
3. **Builds the Plan** — what would be tagged, what's already tagged.
4. **In dry-run mode**, prints the Plan and exits.
5. **In a TTY**, prompts for confirmation (`--yes` skips).
6. **Mints tags** for each entry in the awaiting-release set. Tags are
   per-package by default: `pkg-name@1.2.3`.
7. **Fires each package's `release` plugin op** — the publish hook.
8. **Optionally pushes tags** (`--push` or `git.auto-push`).

A few subtleties worth knowing:

- **A `release` op failure does *not* roll back the tag.** The
  contract treats publish failures as data, not exceptions: dv records
  the per-package outcome and continues. Re-run `dv release --force`
  after fixing the underlying issue to retry just the failed packages.
- **Manual version edits are released too.** If someone hand-edits a
  manifest, `dv release` notices the new version (it has no tag yet)
  and tags it. There's no "dv didn't know about this version" case;
  the tag is the truth.
- **Re-running is a no-op.** Once everything's tagged, the
  awaiting-release set is empty and `dv release` exits early. Safe to
  bake into CI.

## The 0.x → 1.0 transition is its own command

`dv version` can produce any bump *except* the `0.x → 1.0` transition.
That's deliberate — see [SemVer and stability](/concepts/semver-and-stability)
for the algebra. The transition is a deliberate ceremony, invoked as:

```sh
$ dv v1 @my/api
About to commit @my/api to 1.0.0 — this is a stability promise.
Proceed? [y/N] y

✓ promoted @my/api 0.7.4 → 1.0.0
```

`dv v1` does everything `dv version` does — consumes Records,
projects to `1.0.0` exactly, writes manifests, cascades constraints to
`^1.0.0`, commits — but the target version is pinned. There's no other
way for a package to cross from `0.x` to `1.0.0`.

The next `dv release` after `dv v1` celebrates the milestone with a 🎉
in the summary.

## Configuration knobs

A few config options affect this phase that are worth knowing about
(full list in the [config reference](/reference/config-format)):

```yaml
git:
  require-clean-tree: true       # `dv version` halts on a dirty tree
  auto-commit: true              # phase 1 creates the commit
  auto-push: false               # phase 2 doesn't push tags by default
  sign: auto                     # honor git's signing config
  push-sequence: publish-then-push

publishing:
  timeout: none                  # release ops have no timeout by default

safety:
  dry-run-by-default: false      # flip both phases to default --dry-run
```

`safety.dry-run-by-default: true` is a useful gate for high-stakes
repos or onboarding — every destructive run is a preview until you
opt in with `--no-dry-run`. The corresponding flag is always available.

## When something looks wrong

A few common situations:

**The Plan shows a bump I didn't expect.** Check the pending Records
(`ls .dv/records/`). Each Record contributes one or more bumps. If the
plan says `minor` and you expected `patch`, a Record somewhere is
`feat`-typed.

**The cascade rewrote a dependency I didn't expect.** The cascade runs
against *every* discovered package. The plugin filters at execution
time by responding `changed: false` for packages that don't carry the
dep. If a rewrite happened, it's because the plugin found the dep in
the dependent's manifest. Audit the manifest.

**`dv release` says "nothing to release" but I bumped a package.** Look
for a git tag matching `{package}@{version}`. If it exists, that's the
release-state signal; dv considers the package released. Delete the
tag (if it shouldn't exist) or run with `--force` (to re-run release
ops without minting a new tag).

**`dv version` halts on Unresolved References.** Some Records target
packages dv can't find. Either record a rename
(`dv rename <old> <new>`) or pass `--prune` to drop the stale
references.

## Next

- **[SemVer and stability](/concepts/semver-and-stability)** — why
  pre-1.0 packages can't accidentally hit `1.0.0`, and why `dv v1`
  is its own command.
- **[CLI reference](/reference/cli)** — every flag for every command.
- **[Config reference](/reference/config-format)** — the full
  `.dv/config.yaml` shape including all the knobs above.
