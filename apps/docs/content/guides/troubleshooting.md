# Troubleshooting

Common errors, what they mean, and how to recover. Organized by symptom
so you can scan for what you're seeing.

Every error dv emits carries a structured **error code** (visible in the
human output and in the `--json` envelope). The code is searchable on
this page.

## Discovery and config

### `dv: no config found`

```
no config found — run `dv init` to scaffold .dv/config.yaml
```

You're running a dv command from a directory that doesn't contain
`.dv/config.yaml`. Either:

- You're in the wrong directory (`cd` to the repo root).
- You haven't initialized the repo yet (`dv init`).
- You initialized a parent directory; dv looks for `.dv/` in the
  current dir, not by walking up. Run from the directory containing
  `.dv/`.

### `config-not-found` / `config-parse`

```
dv error[config-not-found]: cannot read .dv/config.yaml
dv error[config-parse]: .dv/config.yaml is not valid YAML
```

The config file is missing or malformed. `dv status` is tolerant
(it falls back to the no-config message above); every other command
requires a valid config.

Recovery: run `dv migrate config --dry-run` to see whether your config
matches the current schema shape. If it doesn't, run without
`--dry-run` to rewrite it.

### `config-legacy-use-shape`

```
dv error[config-legacy-use-shape]: discovery.plugins[0].use is a bare
  string — wrap it in a discriminated form (path:, builtin:, command:,
  or run:). See `dv migrate config`.
```

Your config uses an older `use:` syntax (a bare string). Run:

```sh
$ dv migrate config
```

This rewrites every legacy `use:` into the current discriminated form
while preserving comments and formatting (text-in / text-out per
migration step). See [config-format.md](/reference/config-format) for
the current shape.

### `config-unknown-key` / `config-shape`

A field in your config isn't recognised or doesn't match its schema.
The hint message will name the field. Common causes:

- A typo (`disovery:` instead of `discovery:`).
- A field that existed in a previous schema version and was removed
  or renamed (run `dv migrate config` to migrate it).
- A value of the wrong type (string where a list is expected, etc.).

The [config-format reference](/reference/config-format) is the
authoritative shape.

### `not-a-git-repo`

```
dv error[not-a-git-repo]: this directory is not inside a git repository
```

dv is git-native — every command assumes a git repo and uses it
directly. Initialize one (`git init`) or run from inside a checkout.

## Records

### `malformed-records`

```
dv error[malformed-records]: 2 record files failed to parse
  — run `dv validate` to see details
```

One or more files in `.dv/records/` aren't valid dv Records. Run:

```sh
$ dv validate
```

`dv validate` lists every problem with every Record, plus any config
or rename-ledger issues. Common Record problems:

- **`frontmatter-missing`** — the file has no YAML frontmatter block.
- **`frontmatter-shape`** — the frontmatter is valid YAML but doesn't
  have the required fields (`type`, `packages`).
- **`body-empty`** — the markdown body below the frontmatter is empty.
  Add a description, even a one-liner.

See the [Records reference](/reference/record-format) for the exact format.

### `unresolved-reference`

```
dv error[unresolved-reference]: 1 record references a Package not found
  — pass --prune to drop them, or use `dv rename` to record the lineage
```

A Record's `packages` list contains a name that doesn't match any
discovered package. Three causes:

1. **The package was renamed.** Use `dv rename <old> <new>` to
   record the lineage edge. Records referencing the old name resolve
   to the new package after that.
2. **The package was deleted.** Pass `--prune` to `dv version` /
   `dv v1` to drop the stale references along with the consumed
   Records.
3. **The reference is a typo.** Edit the Record to fix the name.

Both `--prune` and `dv rename` are safe — neither destroys history;
they're just lineage bookkeeping.

### `package-conflict`

```
dv error[package-conflict]: package path 'packages/api' is claimed by
  both 'run:deno run -A …' and 'run:node ./tools/npm-plugin.js'
```

Two plugin assignments would discover the same package path.
`dv` refuses to guess which plugin owns it. Fix by narrowing the
`match` globs in `.dv/config.yaml` so each path is claimed by exactly
one plugin.

## Plugins

### `plugin-contract-mismatch`

```
dv error[plugin-contract-mismatch]: plugin reports contractVersion '2'
  but this dv speaks '1'
  hint: upgrade or downgrade the plugin to match this dv's contract
```

The plugin's `info` op returned a contract version dv doesn't speak.
Either upgrade dv to match the plugin, or use a plugin version that
speaks dv's contract.

For the example plugins in this repo, the contract version is set
explicitly in `info` — if you forked from an old example, update its
`contractVersion` field.

### `plugin-not-found` / `plugin-command-not-found`

```
dv error[plugin-not-found]: cannot resolve plugin reference 'path:./tools/missing'
dv error[plugin-command-not-found]: command 'dv-plugin-npm' not on $PATH
```

The `use:` reference in `.dv/config.yaml` doesn't point at a real
executable. For `path:` references, check the file exists. For
`command:`, check `which <name>` resolves it. For `run:`, check that
the first token (`deno`, `node`, `python`, whatever) is on `$PATH`.

### `plugin-not-executable`

```
dv error[plugin-not-executable]: plugin not executable (chmod +x?):
  /repo/tools/my-plugin
```

The file exists but isn't executable. For a script plugin: `chmod +x
/repo/tools/my-plugin`. For a `run:` reference (which doesn't need
chmod since the interpreter is what gets invoked), check the script
path is correct.

### `plugin-exit-nonzero`

```
dv error[plugin-exit-nonzero]: plugin read-version failed (exit 1):
  cannot read package.json: ENOENT
  hint: check the plugin's stderr above for the underlying error
```

The plugin process exited non-zero. dv passes its stderr through, so
the underlying error is whatever the plugin printed. Common causes:

- **Missing file** — the manifest the plugin expects isn't there.
- **Plugin bug** — something in the plugin code threw an uncaught
  exception. Re-run with `--debug` (see below) to see the full
  invocation; reproduce with `dv plugin invoke` to iterate.
- **Stale dependencies** — the plugin uses tools that aren't
  installed in this environment.

### `plugin-bad-response`

```
dv error[plugin-bad-response]: plugin's response did not validate
  against the read-version schema
```

The plugin returned JSON, but it didn't match the expected shape for
the op. dv validates every response against a per-op Zod schema; the
error names the op and lists what was wrong.

Re-check the [plugin contract reference](/reference/plugin-contract)
for the exact response shape. Use `dv plugin invoke <plugin> <op>` to
exercise the op in isolation and see the raw stdout.

### `plugin-run-parse`

```
dv error[plugin-run-parse]: plugin stdout was not valid JSON
```

The plugin wrote something to stdout that wasn't JSON — likely an
accidental log statement. dv requires the response to be a single
JSON document on stdout; human-readable logs belong on stderr.

Common culprits:

- A `console.log(...)` debug print left in the plugin code (route to
  `console.error` instead).
- A library writing to stdout by default (configure it to use stderr).
- A shell script's `set -x` output leaking into stdout (redirect
  with `set -x` → stderr or remove).

### `plugin-timeout`

```
dv error[plugin-timeout]: plugin discover timed out after 60000ms
  hint: raise the per-Op timeout in config or speed up the plugin
```

The plugin took longer than the configured per-op timeout. For
`discover` / `read-version` / `write-version` / `update-dependency`,
the default is `60s` (config: `discovery.plugins[i].timeout`). For
`release`, the default is `none` (no timeout) — set it explicitly in
`publishing.timeout` if you want one.

### Using `--debug` to investigate

Any plugin-related error gets clearer with `--debug`:

```sh
$ dv version --dry-run --debug 2>&1 | head -20

[dv:debug] ▶ discover via deno run -A ./examples/plugins/deno/main.ts
  exec: deno run -A ./examples/plugins/deno/main.ts discover
  env: DV_DISCOVER_GLOB=packages/* DV_OPERATION=discover DV_REPO_ROOT=/repo
  stdin: (none)
  timeout: 60000ms
[dv:debug] ✓ discover (32ms)
  exit: 0
  stdout: {"packages":[{"name":"@my/api","path":"packages/api"}]}
  stderr: (empty)
```

Every plugin invocation gets one block: op, env vars dv passed,
stdin payload (if any), stdout, stderr, exit code, duration. This is
the answer to "why did my plugin fail inside dv version" without
reaching for `dv plugin invoke`.

## Git

### `dirty-tree`

```
dv error[dirty-tree]: the working tree has uncommitted changes
  hint: commit or stash your changes, or pass --allow-dirty
```

`dv version` and `dv release` (and `dv v1`) refuse to run with a
dirty working tree by default. Three recovery paths:

1. **Commit or stash your changes**, then re-run.
2. **Pass `--allow-dirty`** to override for this run.
3. **Set `git.require-clean-tree: false`** in `.dv/config.yaml` to
   make this the default. The `--no-allow-dirty` flag still lets you
   force the check on per-run.

`--allow-dirty` is fine for local experimentation. For CI, prefer the
clean-tree default — it catches "I forgot to commit my plugin change."

### `git-commit-failed`

```
dv error[git-commit-failed]: git commit returned non-zero
```

Usually means a `pre-commit` hook rejected the commit. Check the
hook's output (visible on stderr above the error). The Release PR
commit has to land cleanly, so either:

- Fix what the hook is complaining about (typically a formatter or
  linter), or
- Pass `--no-commit` to skip the auto-commit and create your own.

dv never uses `--no-verify`. If a hook is wrong, fix the hook.

### `git-tag-failed`

```
dv error[git-tag-failed]: tag 'pkg-name@1.2.3' already exists
```

The tag dv tried to mint already exists. dv considers a package
released iff its current version has a matching tag, so this usually
means the package is already released and `dv release` is a no-op for
it (it won't reach this error in a normal flow).

If you genuinely want to re-tag (rare — usually a mistake), delete
the tag manually first (`git tag -d <name>`), then re-run.

### `git-push-failed`

```
dv error[git-push-failed]: git push failed
  hint: check your remote, credentials, and branch protection rules
```

`dv release --push` (or `git.auto-push: true`) tried to push tags
and got rejected. Common causes:

- **Auth** — no credentials, expired token, push not allowed from
  this branch.
- **Branch protection** — a rule blocks tag pushes.
- **Concurrent push** — someone else pushed conflicting tags;
  fetch + retry.

With `push-sequence: publish-then-push` (the default), publishing
already happened before the push attempt. If publish succeeded but
push failed, the packages *are* released — the tags just aren't
upstream yet. Push them manually (`git push --tags`) once the cause
is resolved.

## Release-specific

### `release-partial-failure`

```
dv error[release-partial-failure]: 1 of 3 package(s) failed to publish
  hint: rerun `dv release --force` after addressing each sub-error
        (tags are already in place)
```

Some packages' `release` ops failed; others succeeded. Tags were
already minted for every package (tags don't roll back on publish
failure — that's by design).

Recovery: fix the underlying cause (registry credentials, network,
whatever the per-package error says), then:

```sh
$ dv release --force
```

`--force` re-runs the `release` op for every package, including
already-tagged ones. No new tags are minted.

The `--json` envelope contains a per-package outcome list so
automation can identify exactly which packages need a retry.

### `release-cancelled`

```
dv error[release-cancelled]: user declined the release confirmation
```

You ran `dv release` interactively and answered `n` (or pressed
Enter) at the prompt. No tags were minted; no publish ops fired.
Re-run with `--yes` to skip the prompt.

### `release-op-failed` (sub-error)

A sub-error inside a `release-partial-failure`. Names the specific
package and includes the plugin's error message. Not raised as a
top-level error.

## v1 promotion

### `v1-already-stable`

```
dv error[v1-already-stable]: package 'core' is at 1.2.3, which is
  already >= 1.0
  hint: `dv v1` only promotes 0.x.y Packages to 1.0.0; subsequent
        stable bumps go through `dv version`
```

You ran `dv v1 <pkg>` on a package that's already at or past `1.0.0`.
`dv v1` is only for the `0.x → 1.0` transition. Use `dv version` for
all bumps thereafter — `feat!`/`fix!` Records produce major bumps in
the Stable regime.

### `v1-package-not-found`

```
dv error[v1-package-not-found]: package '@my/api' not found in
  discovered packages
```

The package name you passed to `dv v1` doesn't match any discovered
package. Check the spelling (`dv status` lists every tracked package)
and that discovery is finding the package you mean.

### `v1-bad-args` / `v1-cancelled`

- `v1-bad-args` — wrong number of arguments. `dv v1` takes exactly
  one `<package>` (or zero in dry-run catalog mode).
- `v1-cancelled` — you declined the confirmation prompt. Re-run with
  `--yes` to skip it.

## Confirmation prompts

### `confirmation-required`

```
dv error[confirmation-required]: dv release in a non-TTY context
  requires --yes to confirm
```

You ran a destructive command in a context without a controlling
TTY (CI, a piped invocation, an SSH session without a TTY) and
didn't pass `--yes`. Either:

- **Pass `--yes`** explicitly in the non-interactive context. This
  is the right call for CI.
- **Run in an interactive shell** if you want the prompt back.

## Getting unstuck

If none of the above matches, three diagnostic angles to try:

- **`dv validate`** — runs every safety check (config shape, plugin
  resolution, Record parsing, Unresolved References) and reports
  everything in one shot. CI-friendly.
- **`dv status --json | jq`** — see the full Plan in machine-readable
  form. Useful when human output isn't enough detail.
- **`--debug` on any plugin-touching command** — see every plugin
  invocation in detail. Most plugin-related issues are obvious once
  you can see what dv asked the plugin.

If the error message doesn't match anything here and the diagnostics
above don't make it clear, the [CLI reference](/reference/cli) has
the per-command details, and [the plugin contract](/reference/plugin-contract)
has the per-op wire format.
