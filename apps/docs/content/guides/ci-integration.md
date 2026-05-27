# CI integration

This guide shows how to run dv from CI — specifically GitHub Actions —
in the **Release-PR bot** pattern: dv watches your `main` branch,
opens a PR when there are pending Records, and tags + publishes once
that PR merges. It also covers `dv validate` as a per-PR gate so
malformed Records get caught before they hit `main`.

The shape generalises to GitLab CI / CircleCI / your CI of choice;
the dv side of the contract is platform-agnostic
(`--yes`, `--json`, stable exit codes). Concrete examples here are
GitHub Actions because that's where most teams land.

## The workflow at a glance

Three jobs do three things:

| Job | Trigger | Purpose |
|---|---|---|
| **validate** | every PR | `dv validate` — catch bad Records pre-merge |
| **prepare-release** | push to `main` | `dv version` — open a Release PR if Records are pending |
| **release** | push to `main` after Release PR merges | `dv release` — tag + publish |

The "prepare-release" and "release" jobs both fire on `push: main`.
They distinguish themselves at runtime: prepare-release exits early
if there are no pending Records (which is true once the Release PR
has merged); release exits early if every current version already
has a tag (which is true on every non-release commit). Each one is
idempotent and safe to run on every push.

## Installing dv in CI

`dv` is a Deno program. The intended distribution channel is JSR
(`@dv-cli/dv`), which gives you a one-line install in any CI runner
with Deno available:

```yaml
- uses: denoland/setup-deno@v2
  with:
    deno-version: v2.x
- run: deno install --global --allow-all --name dv jsr:@dv-cli/dv
```

::: warning Pre-1.0 status
As of writing, `@dv-cli/dv` is still pre-1.0 (no JSR publish yet).
Until the first release, install from source:

```yaml
- uses: denoland/setup-deno@v2
  with:
    deno-version: v2.x
- run: git clone --depth 1 https://github.com/ben-laird/dv /tmp/dv
- run: deno install --global --allow-all --name dv /tmp/dv/apps/cli/src/main.ts
```

Once `dv release` ships `@dv-cli/dv` to JSR, the install shrinks to
the one-liner above.
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
name: dv validate

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

      # Install dv (see "Installing dv in CI" above for the JSR
      # one-liner once @dv-cli/dv is published).
      - run: git clone --depth 1 https://github.com/ben-laird/dv /tmp/dv
      - run: deno install --global --allow-all --name dv /tmp/dv/apps/cli/src/main.ts

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

## Job 2: prepare the Release PR

After the PR with a Record merges to `main`, this job runs and
opens a **Release PR** — a commit produced by `dv version` that
contains every manifest bump, every CHANGELOG entry, and every
constraint rewrite for the accumulated Records.

```yaml
# .github/workflows/dv-prepare-release.yml
name: dv prepare release

on:
  push:
    branches: [main]

# Single in-flight Release PR at a time — concurrent prepare runs
# would race on the branch and clobber each other's commits.
concurrency:
  group: dv-prepare-release
  cancel-in-progress: false

jobs:
  prepare:
    runs-on: ubuntu-latest
    # Skip on the prepare-release commit itself (the bot's own
    # commit) so we don't recurse into ourselves. The check is
    # cheap — `dv version --dry-run` would also exit "nothing to
    # version" since the Records were consumed.
    if: "!contains(github.event.head_commit.message, 'chore(release):')"

    permissions:
      contents: write       # commit the bump
      pull-requests: write  # open / update the Release PR

    steps:
      - uses: actions/checkout@v6
        with:
          # We need full history so dv can read existing tags
          # for the awaiting-release computation.
          fetch-depth: 0
          # PAT or GITHUB_TOKEN so the push triggers downstream
          # workflows (a bare GITHUB_TOKEN's push will NOT trigger
          # other Actions workflows; that's a documented GitHub
          # safety rule).
          token: ${{ secrets.DV_PAT }}

      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - run: git clone --depth 1 https://github.com/ben-laird/dv /tmp/dv
      - run: deno install --global --allow-all --name dv /tmp/dv/apps/cli/src/main.ts

      # Cheap early-out: if no Records are pending, there's
      # nothing to release. dv version itself would exit 0 with
      # "nothing to version" — checking explicitly lets the
      # workflow short-circuit before we touch the branch.
      - name: check for pending Records
        id: check
        run: |
          PENDING=$(dv status --json | jq '.pending | length')
          echo "pending=$PENDING" >> "$GITHUB_OUTPUT"

      - name: configure git identity
        if: steps.check.outputs.pending != '0'
        run: |
          git config user.name "dv-bot"
          git config user.email "dv-bot@users.noreply.github.com"

      # The actual bump. dv version writes manifests + CHANGELOGs,
      # cascades constraints, deletes consumed Records, and creates
      # one commit. Non-interactive so we don't hang on a confirm
      # prompt that never arrives.
      - name: run dv version
        if: steps.check.outputs.pending != '0'
        run: dv version --yes

      # Push to a stable branch name so reruns update an existing
      # PR rather than spawning new ones. --force-with-lease keeps
      # us safe if someone pushed to the branch in the meantime
      # (rare; the concurrency: gate already serializes us).
      - name: push to dv-release branch
        if: steps.check.outputs.pending != '0'
        run: |
          git push --force-with-lease origin HEAD:dv-release

      # Open the PR (or update the existing one). Title + body
      # are templated from the bump summary.
      - name: open / update Release PR
        if: steps.check.outputs.pending != '0'
        env:
          GH_TOKEN: ${{ secrets.DV_PAT }}
        run: |
          BODY=$(dv status --json | jq -r '
            "## Pending bumps\n\n" +
            (.tracked | map("- `" + .package + "` " + .currentVersion) | join("\n"))
          ')
          # If a PR is already open for dv-release, gh pr edit
          # updates it; otherwise gh pr create makes a new one.
          if gh pr view dv-release --json number > /dev/null 2>&1; then
            gh pr edit dv-release --body "$BODY"
          else
            gh pr create \
              --base main \
              --head dv-release \
              --title "chore(release): version bumps" \
              --body "$BODY"
          fi
```

Things to know:

- **The `if: !contains(...)` guard is essential.** Without it, the
  workflow recurses: the prepare commit itself triggers another
  prepare run, which exits "nothing to version" but still wastes a
  CI minute. The string `chore(release):` matches dv's default
  `git.commit-message-template`; if you've customised it, update
  the guard.
- **`concurrency:` serializes prepare runs.** Two pushes landing
  close together would otherwise race — both would compute the same
  bump, push the same branch, and the second `git push
  --force-with-lease` would either fail or silently clobber the
  first. The concurrency group prevents it.
- **`fetch-depth: 0`** is required because `dv release`'s
  awaiting-release computation reads existing tags via `git`. A
  shallow clone hides them. (`dv version` itself doesn't strictly
  need full history, but the next job does, and consistent clone
  shape avoids surprises.)
- **`secrets.DV_PAT` instead of `GITHUB_TOKEN`** is a GitHub-Actions
  quirk: pushes made with the default `GITHUB_TOKEN` don't trigger
  downstream Actions workflows. If you want the merged Release PR
  to fire the `release` job below, the push needs to come from a
  PAT (or a GitHub App token). See
  [GitHub's docs](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow).

## Job 3: tag and publish on merge

This job also fires on `push: main`. It runs `dv release`, which is
**stateless** — it computes the awaiting-release set from git tags
and is a no-op on any commit where every current version is already
tagged. So it's safe to run on every push.

```yaml
# .github/workflows/dv-release.yml
name: dv release

on:
  push:
    branches: [main]

concurrency:
  group: dv-release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest

    permissions:
      contents: write   # push tags

    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          # tags need to come too so dv release can see existing
          # ones for the stateless awaiting-release check.
          fetch-tags: true

      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - run: git clone --depth 1 https://github.com/ben-laird/dv /tmp/dv
      - run: deno install --global --allow-all --name dv /tmp/dv/apps/cli/src/main.ts

      # Wire any credentials your release plugin needs. For an npm
      # publish, that's the NPM_TOKEN. For deno publish, it's the
      # OIDC token GitHub Actions provides automatically (assuming
      # you've set up trusted publishing on JSR).
      - name: configure git identity for tags
        run: |
          git config user.name "dv-bot"
          git config user.email "dv-bot@users.noreply.github.com"

      # The release. --yes is required (no TTY in CI); --push tells
      # dv to push tags to origin once publishing succeeds. The
      # default publish-then-push sequence means a failed publish
      # doesn't leave an unrecoverable pushed tag.
      - name: run dv release
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: dv release --yes --push
```

A few patterns worth knowing:

- **Idempotence is your friend.** Re-running this workflow on a
  commit where everything's tagged exits 0 with "nothing to
  release" and does nothing. You can wire this to scheduled triggers
  too if you want belt-and-braces.
- **Plugin credentials live in env vars.** dv passes the full env
  through to each plugin's `release` op. Set whatever secrets your
  plugin needs (`NPM_TOKEN`, `CARGO_REGISTRIES_*_TOKEN`, etc.) at
  the step level.
- **Partial failures don't roll back.** If three packages need
  releasing and one publish fails, the other two ship and the tags
  for all three exist. The workflow exits non-zero, you fix the
  cause, and `dv release --force` (manual or via a `workflow_dispatch`
  trigger you add) re-runs the publish ops.

## Optional: a manual recovery trigger

For the partial-failure case (or any reason you'd want to manually
re-run release), add a `workflow_dispatch` trigger to the release
workflow:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      force:
        description: "Pass --force to re-run release ops on already-tagged packages"
        type: boolean
        default: false

# ... rest of the workflow ...

      - name: run dv release
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          FORCE=""
          if [ "${{ inputs.force }}" = "true" ]; then
            FORCE="--force"
          fi
          dv release --yes --push $FORCE
```

Now you can fire a release run manually from the Actions tab, with
or without `--force`, when something needs retrying. See [Cut a
release § Handling a partial-failure](/guides/cut-a-release#handling-a-partial-failure)
for the recovery flow.

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

## What's next

- **[Cut a release](/guides/cut-a-release)** — the same flow,
  walked through interactively. Useful for understanding what the
  CI workflow above is automating.
- **[Troubleshooting](/reference/troubleshooting)** — every error code
  dv emits, indexed by symptom. Bookmark for when CI fails at 2am.
- **[CLI reference](/reference/cli)** — every flag for every
  command. The automation surface (`--yes`, `--json`, `--dry-run`)
  is identical across commands; this is the canonical list.
