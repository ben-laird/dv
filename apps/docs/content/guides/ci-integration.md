# CI integration

This guide shows how to run dv from CI — specifically GitHub Actions —
in the **release-on-merge** pattern: `main` is your only long-lived
branch and doubles as both the nightly branch and the release branch.
Every push to `main` is a nightly; the git tags dv mints (`pkg@x.y.z`)
are the official releases. It also covers `dv validate` as a per-PR gate
so malformed Records get caught before they hit `main`.

This is plain [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow):
short-lived feature branches, one trunk, no release branches. dv is
relaxed about this — the two-phase release model (`dv version` then
`dv release`) supports other shapes too (see
[Two-phase release](/concepts/two-phase-release)) — but release-on-merge
is the simplest setup and the one dv itself uses.

The shape generalises to GitLab CI / CircleCI / your CI of choice;
the dv side of the contract is platform-agnostic
(`--yes`, `--json`, stable exit codes). Concrete examples here are
GitHub Actions because that's where most teams land.

## The workflow at a glance

Two jobs do two things:

| Job | Trigger | Purpose |
|---|---|---|
| **validate** | every PR | `dv validate` — catch bad Records pre-merge |
| **release** | push to `main` | `dv version` + `dv release` — bump, tag, publish; no-op when nothing's pending |

There is no separate "Release PR" step. The feature PR that merges to
`main` is *both* the code review and the release review: the version
bump is derived deterministically from the Records that PR carried, so
once it's approved and merged there's nothing further to gate. The
release job runs `dv version` (which commits the bump straight to
`main`), then `dv release` (which tags + publishes). Both are
idempotent and safe on every push — on a commit with no pending Records
the whole job is a ~5s no-op.

## Installing dv in CI

`dv` is a Deno program published to JSR as `@dv-cli/dv`. Install
it in any CI runner with Deno available:

```yaml
- uses: denoland/setup-deno@v2
  with:
    deno-version: v2.x
- run: deno install --global --allow-all --name dv jsr:@dv-cli/dv
```

::: tip Dogfooding from a feature branch?
If you're testing `dv` changes on your own fork before they hit
JSR, install from source by writing a launcher script. **Don't
use `deno install --global` against a workspace member's `main.ts`**
— it snapshots the file but loses the workspace's `imports` map,
so cross-package references won't resolve. The launcher pattern
below mirrors what `deno task install` writes locally for dev:

```yaml
- uses: actions/checkout@v6
- uses: denoland/setup-deno@v2
  with:
    deno-version: v2.x
- name: install dv from source
  run: |
    mkdir -p "$HOME/.local/bin"
    cat > "$HOME/.local/bin/dv" <<EOF
    #!/bin/sh
    exec deno run --allow-all \\
      --config "$GITHUB_WORKSPACE/apps/cli/deno.json" \\
      "$GITHUB_WORKSPACE/apps/cli/src/main.ts" \\
      "\$@"
    EOF
    chmod +x "$HOME/.local/bin/dv"
    echo "$HOME/.local/bin" >> "$GITHUB_PATH"
```
:::

You'll also need any plugins your repo references — same install
approach. If your plugin is `path:` (lives in the repo), nothing
extra is needed; `command:` plugins need to be on PATH; `run:`
plugins need their interpreter (`deno`, `node`, etc.) available.

## Job 1: validate on every PR

The simplest job and the highest-leverage one for day-to-day use.
`dv validate` runs every safety check that doesn't require write
permissions — config shape, plugin resolution, Record parsing,
Unresolved References — and exits non-zero if any of them fail.

```yaml
# .github/workflows/dv-validate.yml
name: validate

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - run: deno install --global --allow-all --name dv jsr:@dv-cli/dv

      - run: dv validate --json
```

`dv validate --json` emits a structured envelope so any extra
tooling (a custom commenter, a metrics collector) can consume it.
For most teams, the exit code is enough — failure surfaces in
GitHub's PR check, the author clicks through to logs, fixes the
Record, pushes again.

What this catches:

- **Malformed Records** — missing frontmatter, wrong types,
  empty bodies.
- **Unresolved References** — a Record points at a package dv
  doesn't know. Either rename or prune; either way, fix before
  merging.
- **Config drift** — `.dv/config.yaml` got edited into an invalid
  shape.
- **Plugin resolution failures** — a `path:` reference points at a
  file that's gone, a `command:` reference isn't on PATH, etc.

Make this a **required status check** in your branch protection so
no PR can merge to `main` — and therefore trigger a release — until
validate is green. The [branch-protection setup script](#branch-protection)
below wires this up.

## Job 2: release on merge to main

After a PR with a Record merges to `main`, this job runs `dv version`
then `dv release`. It's the whole release pipeline in one job:

1. **Capture the pending Plan** (`dv status --json`) *before* anything
   mutates state, so the run log reflects the bumps. (`dv version`
   consumes the Records, so querying status afterward would show
   nothing pending.)
2. **Early-out** if nothing is pending — a nightly with no release.
3. `dv version --yes` — bump manifests, write CHANGELOGs, cascade
   constraints, consume Records, and auto-commit on `main`.
4. **Push the bump commit** back to `main`.
5. `dv release --yes --push` — mint per-package tags and publish.
6. **Mint one GitHub Release** per newly-minted tag, body sliced from
   the package's freshly-written CHANGELOG.md section.

Because that's more logic than belongs in inline YAML, the
orchestration lives in a small Deno script
(`.github/scripts/release.ts`) and the workflow just calls it. Deno
keeps the script cross-platform and lets it use the official GitHub
client (`@octokit/rest`) to mint the Releases:

```yaml
# .github/workflows/dv-release.yml
name: release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      force:
        description: "Pass --force to re-run publish ops on already-tagged packages (recovery)"
        type: boolean
        default: false

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest

    # Skip dv's own bump commits (step 4) so the push to main doesn't
    # re-trigger this job. The string matches dv's default
    # git.commit-message-template.
    if: "!contains(github.event.head_commit.message, 'chore(release):')"

    permissions:
      contents: write   # push bump commit + tags, create GitHub Releases
      id-token: write   # OIDC for `deno publish` auth to JSR

    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          fetch-tags: true
          # PAT, not GITHUB_TOKEN: the bump commit pushed to protected
          # main needs the bot's protection bypass, and PAT-driven
          # pushes trigger downstream workflows (e.g. a tag-listening
          # docs deploy). A bare GITHUB_TOKEN does neither.
          token: ${{ secrets.DV_PAT }}

      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - run: deno install --global --allow-all --name dv jsr:@dv-cli/dv

      - name: configure git identity
        run: |
          git config user.name "dv-release-bot"
          git config user.email "dv-release-bot@users.noreply.github.com"

      - name: release
        env:
          DV_PAT: ${{ secrets.DV_PAT }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          FORCE=""
          if [ "${{ inputs.force }}" = "true" ]; then
            FORCE="--force"
          fi
          deno run \
            --allow-run --allow-read --allow-env --allow-net \
            "$GITHUB_WORKSPACE/.github/scripts/release.ts" $FORCE
```

Things to know:

- **The `if: !contains(...)` guard is essential.** The bump commit
  this job pushes to `main` would otherwise re-trigger the job. The
  string `chore(release):` matches dv's default
  `git.commit-message-template`; if you've customised it, update the
  guard.
- **`concurrency:` serializes release runs.** Two pushes landing close
  together would otherwise race on the bump commit and the tags.
- **`fetch-depth: 0` + `fetch-tags: true`** are required: `dv release`
  computes its awaiting-release set by reading existing tags via git. A
  shallow clone hides them.
- **`secrets.DV_PAT` instead of `GITHUB_TOKEN`** for two reasons: the
  bump commit pushes straight to protected `main` (the bot needs a
  protection bypass — see [branch protection](#branch-protection)), and
  PAT-driven pushes trigger downstream Actions workflows where a bare
  `GITHUB_TOKEN` wouldn't.
- **Partial failures don't roll back.** If three packages need
  releasing and one publish fails, the other two ship and the tags for
  all three exist. The job exits non-zero; re-run with `--force` from
  the Actions tab (the `workflow_dispatch` input above) to retry the
  publish ops on already-tagged packages.

### Where do the GitHub Release notes come from?

`dv release --json` reports *which* tags it minted, but not their
release notes. The script recovers the notes by slicing the relevant
section out of each package's `CHANGELOG.md` (Keep a Changelog format:
the block from `## [version]` to the next `## [`). A native
dv-emitted release-notes field is on the [roadmap](https://github.com/ben-laird/dv/blob/main/ROADMAP.md);
until then, the CHANGELOG is the source of truth and the slice is the
pragmatic bridge.

## Branch protection

Release-on-merge means a merge to `main` ships a release, so the
guardrails on `main` *are* your release safety. Apply them with the
setup script (Deno, idempotent, guarded behind `--confirm`):

```sh
GITHUB_TOKEN=<repo-admin-token> \
  deno run --allow-env --allow-net \
  .github/scripts/setup-branch-protection.ts --confirm
```

It sets, on `main`:

- **required status check: `validate`** — no merge until the PR is
  green.
- **required PR review** (≥1 approval, configurable via `--reviews`) —
  the merge is the release review.
- **linear history** — squash/rebase merges only.
- **no force-push, no deletion.**
- **a bypass for the release bot** so its bump commit (step 4 above)
  can push straight to protected `main`.

That last carve-out is the one place release-on-merge bends a rule: the
bot commits the bump without its own PR. That's intentional — the bump
is deterministic from the already-approved Records, so re-reviewing it
would be ceremony. If you'd rather gate the bump too, you want the
Release-PR variant instead (see [Two-phase release](/concepts/two-phase-release)).

## Optional: validate plugin contracts in CI

If your repo ships its own plugins (vs. just consuming them), wire
`dv plugin verify` into the validate job so plugin contract drift
gets caught the same way Records do:

```yaml
- name: verify plugins
  run: |
    dv plugin verify "path:./tools/my-plugin"
    dv plugin verify "run:deno run -A ./tools/another-plugin/main.ts"
```

`dv plugin verify` exercises every safe op (`info`, `discover`,
`read-version`, `finalize`, bad-input rejection) and reports
skipped ops for the side-effectful ones. Exit code is non-zero if
any check fails. See [Write a plugin § dv plugin verify](/tutorials/write-a-plugin#dv-plugin-verify-contract-conformance)
for the local equivalent.

## Things to know going in

A few non-obvious bits of context that'll save you debugging time:

- **dv is non-interactive by default in CI.** All commands accept
  `--yes` to skip confirmation prompts. Forgetting it on a TTY-less
  runner manifests as a `confirmation-required` error (see
  [Troubleshooting](/reference/troubleshooting#confirmation-required)).
- **The exit codes are stable.** Document them once and rely on
  them: 0 = success, non-zero = failure, with specific codes (like
  `release-partial-failure`) for cases that automation should treat
  differently. See the [CLI reference](/reference/cli) for the
  per-command exit-code semantics.
- **Use `--json` for anything you'd parse.** The human-readable
  output isn't stable; the JSON envelopes are versioned schemas. If
  your workflow grep's a human message and someone improves the
  wording, you'll find out the hard way.
- **`dv` writes to stdout for results, stderr for progress.** The
  progress reporter (`writing version`, `cascading constraints`,
  etc.) goes to stderr; JSON envelopes go to stdout. Capture each
  separately if your workflow needs both.
- **`safety.dry-run-by-default` is a useful guard for early
  adoption.** Flip it on in `.dv/config.yaml`, and every destructive
  command defaults to preview-only. Once you trust the workflow,
  flip it off (or override per-run with `--no-dry-run`).

## Real-world example: dv itself

The dv repo dogfoods this workflow. dv first shipped `@dv-cli/dv@0.7.0`
to JSR through CI on 2026-05-27.

### What worked on the first try

- **OIDC publishing** — no JSR_TOKEN secret. `deno publish` picked up
  the GitHub Actions OIDC token automatically once trusted
  publishing was configured for the package on JSR. Setup was a
  one-time click in JSR's package settings naming `ben-laird/dv` as
  the trusted source.
- **The `DV_PAT` chain** — the default `GITHUB_TOKEN` would neither
  push through branch protection nor trigger downstream workflows; the
  PAT does both.
- **The dv-release plugin** — `tools/dv-release/main.ts` is dv's
  repo-local release plugin (a specialised copy of the example
  Deno plugin where the `release` op actually runs `deno publish`).
  Verified by `dv plugin verify` in CI on every PR.

### Bugs the dogfood surfaced

Real bugs we wouldn't have caught without running the workflows for
real:

1. **`deno install --global` lost workspace context.** The original
   install step did
   `deno install --global --allow-all --name dv $WORKSPACE/apps/cli/src/main.ts`
   — which loses the workspace's `imports` map, so `@dv-cli/clipc`
   didn't resolve and validate failed in 15s with
   `Import "@dv-cli/clipc" not a dependency`. Fix: write a
   POSIX launcher that runs
   `deno run --config apps/cli/deno.json apps/cli/src/main.ts "$@"`
   instead, mirroring what `deno task install` writes locally. The
   workflow snippets above already reflect this fix.

2. **Publish-order bug.** Pre-fix, `dv release` ordered publishes
   alphabetically by path; in this repo `apps/cli` sorted before
   `packages/clipc`, so `@dv-cli/dv` would have tried to publish
   before `@dv-cli/clipc`, and JSR would have rejected it. The
   topological-sort fix landed in the same release.

### One-time JSR setup

Three steps, ~10 minutes:

1. **Create the JSR scope.** [jsr.io/new](https://jsr.io/new) →
   Create scope. Scopes are first-come-first-served, so claim the
   name you want before you advertise the package.
2. **Configure trusted publishing per package.** On each package's
   JSR settings page (`https://jsr.io/@scope/pkg/settings`), find
   "GitHub Actions" and enter `owner/repo`. JSR validates incoming
   publishes against GitHub's OIDC token from that repo only.
3. **In the repo**, give the release workflow the `id-token: write`
   permission. The release workflow above already has this line.
   No JSR_TOKEN secret is needed.

### Authoring tips

A few things that became obvious only after running it for real:

- **Use the `chore(release):` commit-message guard religiously.**
  Without it, the release job re-triggers on its own bump commit and
  you have an infinite loop.
- **Always squash-merge feature PRs.** GitHub's rebase-merge rewrites
  commit hashes, which breaks any tag → commit references in your
  CHANGELOG/HISTORY files. Squash preserves identity. (Required linear
  history in branch protection enforces this.)
- **Make validate a required check.** The
  [branch-protection script](#branch-protection) does this, so a PR
  can't merge — and therefore can't release — if validate failed.

## What's next

- **[Cut a release](/guides/cut-a-release)** — the same flow,
  walked through interactively. Useful for understanding what the
  CI workflow above is automating.
- **[Troubleshooting](/reference/troubleshooting)** — every error code
  dv emits, indexed by symptom. Bookmark for when CI fails at 2am.
- **[CLI reference](/reference/cli)** — every flag for every
  command. The automation surface (`--yes`, `--json`, `--dry-run`)
  is identical across commands; this is the canonical list.
