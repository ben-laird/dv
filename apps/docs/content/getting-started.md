# Getting started

This is a five-minute tour of `dv` end-to-end. You'll set up a tiny monorepo,
author a Record, cut a release, and see what each step actually does. No
prior knowledge of `dv` assumed — by the end you'll know what every command
in the loop is for.

If you already know the shape and just want a reference, skip ahead to the
[CLI reference](/reference/cli).

## What you need

- **A monorepo** — `dv` is designed for repos with multiple packages, but
  single-package repos work as a degenerate case. For this tutorial we'll
  make a tiny one from scratch.
- **A plugin** — `dv` is language-agnostic; you bring (or write) a plugin
  that knows how to read and write your manifests. We'll use the example
  Deno plugin shipped in this repo.
- **Git** — `dv` is git-native. It expects a git repo and uses it directly.

That's it. No Node, no global install for the tutorial — we'll run `dv`
straight from this repo.

## Step 1: scaffold a tiny monorepo

```sh
mkdir my-monorepo && cd my-monorepo
git init -q
mkdir -p packages/api packages/client

# Two packages, each with a deno.json carrying its name + version
cat > packages/api/deno.json <<'EOF'
{ "name": "@my/api", "version": "0.1.0" }
EOF

cat > packages/client/deno.json <<'EOF'
{
  "name": "@my/client",
  "version": "0.1.0",
  "imports": { "@my/api": "^0.1.0" }
}
EOF

git add . && git commit -q -m "scaffold"
```

You now have two packages, with `@my/client` depending on `@my/api`. Both
sit at `0.1.0` — pre-1.0, *unstable* in SemVer terms.

## Step 2: `dv init`

```sh
dv init
```

This writes `.dv/config.yaml` to your repo. The default config wires up
the example Deno plugin and points it at `packages/*`:

```yaml
discovery:
  plugins:
    - match: ["packages/*"]
      use:
        run: deno run -A ./examples/plugins/deno/main.ts
```

It also creates `.dv/records/` — the directory where your Records will
live — and a `.gitignore` so `dv`'s in-progress edit files don't leak
into commits.

Verify the wiring with [`dv status`](/reference/cli):

```sh
$ dv status

Tracked packages — 2 total:
  @my/api      0.1.0  packages/api
  @my/client   0.1.0  packages/client
```

The plugin saw your two packages, read their versions from `deno.json`,
and reported back to `dv`. That's the **discovery** phase — every
command starts with it.

## Step 3: author a Record with `dv add`

You've made a change to `@my/api`. Instead of writing a Conventional
Commit and hoping a parser does the right thing, you tell `dv` directly:

```sh
$ dv add
? type: feat
? packages: @my/api
? notes: add /v2 endpoint with pagination
→ wrote .dv/records/sunset-cliff-roam.md
```

The file `dv` just wrote is the **Record** — a short Markdown file with
frontmatter declaring the change type and affected packages. Open it:

```markdown
---
type: feat
packages:
  - "@my/api"
notes: add /v2 endpoint with pagination
---

Add /v2 endpoint with pagination
```

Records get committed alongside the code change they describe. Commit
this one now:

```sh
git add . && git commit -q -m "feat: add /v2 endpoint"
```

A few things worth noticing:

- **`dv` did not parse a commit message.** The Record is the source of
  truth for what changed. Your commit message can say whatever you want.
- **The `type` field is a small, fixed vocabulary** — `feat`, `fix`,
  `feat!`, `fix!`. Anything else isn't a Record (and isn't a bump-producing
  change). See [Records](/concepts/records) for why.
- **You can author Records by hand** — `dv add` is just a friendly wrapper
  that picks a filename and writes the frontmatter for you. The file
  format is documented in [the Records reference](/reference/record-format).

## Step 4: preview the release with `--dry-run`

Before you actually cut a release, see what `dv version` would do:

```sh
$ dv version --dry-run

Plan (dry-run):
  @my/api 0.1.0 → 0.2.0 (minor)
       └ would update dependents: @my/client
```

`dv` aggregated your pending Records (just one, in this case), looked
up the current version of `@my/api` (`0.1.0`), classified the change
(`feat` in an Unstable package → minor bump), and projected the new
version (`0.2.0`). It also noticed that `@my/client` declares a
constraint on `@my/api` — so when `@my/api` bumps, `@my/client`'s
manifest will get rewritten to point at the new version.

This is the **Plan**. The exact same code that produced this preview
runs in the real version pass — there's no separate dry-run code path
that could drift. See [Two-phase release](/concepts/two-phase-release)
for why this matters.

## Step 5: cut the release with `dv version`

```sh
$ dv version

✓ versioned 1 package, committed a1b2c3d
  @my/api 0.1.0 → 0.2.0 (minor)
  ↳ updated 1 dependent constraint (@my/client)
```

What `dv` did, in order:

1. **Read versions** from every package's manifest (via the plugin's
   `read-version` op).
2. **Aggregated Records** into a per-package Bump — one Record of type
   `feat` against `@my/api` means a minor bump.
3. **Wrote the new version** to `packages/api/deno.json` (via the
   plugin's `write-version` op).
4. **Rendered the CHANGELOG** for `@my/api` and prepended a new section.
5. **Updated dependents** — `@my/client`'s `^0.1.0` constraint was
   rewritten to `^0.2.0`.
6. **Deleted the consumed Record** (`.dv/records/sunset-cliff-roam.md`).
7. **Staged everything into one commit** — under release-on-merge this
   lands on `main`; if you prefer, review it first as a "Release PR".

Look at what changed:

```sh
$ git log -1 --stat

commit a1b2c3d (HEAD -> main)
    chore(release): bump @my/api to 0.2.0

 packages/api/deno.json                       | 2 +-
 packages/api/CHANGELOG.md                    | 9 +++++++++
 packages/client/deno.json                    | 2 +-
 .dv/records/sunset-cliff-roam.md             | 6 ------
```

One commit, four files, no manual editing.

## Step 6: tag and publish with `dv release`

`dv version` rewrote the manifests. `dv release` mints the git tags and
fires each package's release plugin:

```sh
$ dv release
About to release @my/api@0.2.0. Continue? [y/N] y

✓ minted 1 tag
  @my/api@0.2.0

(release plugin invoked — would publish to your registry)
```

The two-phase split is deliberate: `dv version` is reviewable (it's just
a commit), and `dv release` is the *act* of releasing — tagging,
publishing, anything that's hard to roll back. Pushing the tag is opt-in
(`--push` or `git.auto-push` in config).

A package is "released" iff its current version has a matching git tag.
There's no state file — git's tags *are* the state. Re-running
`dv release` is a no-op when everything's already tagged.

## What's next

You've seen the core loop: `add` → `version` → `release`. Two paths from
here:

- **[Records](/concepts/records) and [Two-phase release](/concepts/two-phase-release)** — the
  ideas behind why `dv` is shaped this way. Worth reading once before you
  evaluate `dv` for a real project.
- **[CLI reference](/reference/cli)** — every command, every flag.
  Bookmark for day-to-day use.

The five-minute tour gave you the loop. The concept pages give you the
*model* — and that's what makes `dv` predictable when something looks
weird.
