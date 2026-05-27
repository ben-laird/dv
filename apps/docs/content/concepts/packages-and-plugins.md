# Packages and plugins

A **Package** is anything dv tracks with its own independent version —
typically what your ecosystem calls a crate, module, library, or
workspace member. A **Plugin** is the executable that teaches dv how to
read and write that ecosystem's manifests.

These two concepts together are how dv stays language-agnostic. dv knows
nothing about `Cargo.toml`, `package.json`, or `deno.json`. It knows
about Packages, and it asks Plugins to bridge the rest.

## How dv finds packages

Discovery is configured in `.dv/config.yaml`:

```yaml
discovery:
  plugins:
    - match: ["packages/*", "apps/*"]
      use:
        run: deno run -A ./examples/plugins/deno/main.ts
```

A **plugin assignment** has two parts:

- **`match`** — globs declaring where this plugin is responsible.
- **`use`** — how to invoke the plugin.

When you run any dv command, dv:

1. Walks each plugin assignment.
2. Asks the plugin (via its `discover` op) which packages exist under
   each matching glob.
3. Builds a deduplicated, sorted list of every Package across every
   plugin.

You can have multiple plugin assignments — one for `packages/*` using
the Deno plugin, another for `crates/*` using a Cargo plugin. dv merges
the results. Two plugins claiming the same path is an error; narrow
your globs.

## What a Package is, exactly

A Package, as dv sees it, is just four things:

| Field | What it means |
|---|---|
| **name** | The package's identity in dv (e.g. `@my/api`). Plugin-provided. |
| **path** | Where its manifest lives, repo-relative (e.g. `packages/api`). |
| **plugin** | Which plugin assignment claimed it. |
| **version** | The current SemVer triple, read from the manifest via the plugin. |

That's it. dv doesn't care about source files, build outputs, license
headers, or anything else inside the package — only the manifest. The
plugin owns all the ecosystem knowledge.

## Plugins are executables

A plugin is any executable speaking JSON over stdio. The contract is
documented in [the plugin reference](/reference/plugin-contract); the
short version:

- dv sets environment variables (`DV_REPO_ROOT`, `DV_PACKAGE_NAME`, etc.)
- For some operations, dv writes a JSON payload to the plugin's stdin
- The plugin writes a JSON response to its stdout
- Exit 0 = success, non-zero = failure

That's the whole interface. No SDK, no framework, no required dependency
on a `dv-plugin-*` package. The OS handles routing via the shebang line;
the plugin can be Bash, Node, Python, Rust, Go, anything.

### What operations a plugin implements

A plugin declares its capabilities via the mandatory `info` op:

```json
{
  "contractVersion": "1",
  "supportedOps": [
    "info", "discover", "read-version", "write-version",
    "update-dependency", "release", "finalize"
  ],
  "name": "deno",
  "version": "0.1.0"
}
```

`info` and `discover` are **mandatory**. Everything else is **optional**
— a plugin that omits an op from `supportedOps` just means dv skips
that op for that plugin. A read-only plugin (discovery + read-version
only) is fine; a publish-only plugin (discovery + release) is fine;
combinations are fine.

The op set is small on purpose:

| Op | Purpose |
|---|---|
| `info` | Declare contract version + supported ops. Mandatory, cached. |
| `discover` | Given a glob, list packages. Mandatory. |
| `read-version` | Read the current version of one package. |
| `write-version` | Write a new version to one package's manifest. |
| `update-dependency` | Rewrite a constraint on a bumped dependency. |
| `release` | Publish (or whatever your ecosystem's equivalent is). |
| `finalize` | Refresh generated companion files (lockfiles, etc.). |

For details, see the [plugin contract reference](/reference/plugin-contract).

## Example plugins, not first-party builtins

dv ships **no first-party plugins** in v1. What it ships are
[copyable example plugins](https://github.com/ben-laird/dv/tree/main/examples/plugins):

- **`examples/plugins/deno/`** — a Deno workspace plugin
- **`examples/plugins/npm/`** — an npm workspace plugin

These are **reference material**, not maintained dependencies. The
intent is that you fork one, adapt it to your repo, and own it. This
keeps two things honest:

1. The plugin contract has to be *good enough* for users to write
   plugins from scratch. If dv shipped a polished Node SDK as the
   "right" way, non-Node users would have a worse experience and the
   contract would atrophy.
2. Your plugin can do whatever your repo needs. A real Rust shop's
   plugin probably knows about workspace inheritance and feature
   flags. The example doesn't — but it's a working starting point.

Promoting an example to a supported first-party builtin is a deliberate
future decision (see [v1 scope deferrals](https://github.com/ben-laird/dv/blob/main/specs/v1-scope.md#deferred-to-later)).
For now: copy, adapt, ship.

## How a plugin reference resolves

The `use:` field in a plugin assignment takes one of four shapes:

```yaml
# 1. path:  — a file or directory in your repo
use:
  path: ./tools/dv-plugin

# 2. builtin: — reserved for the future when first-party plugins exist
use:
  builtin: cargo  # not implemented in v1

# 3. command: — an executable on $PATH
use:
  command: dv-plugin-npm

# 4. run: — an interpreter-style invocation (most common today)
use:
  run: deno run -A ./examples/plugins/deno/main.ts
```

`run:` is the workhorse for the examples — it makes it trivial to
invoke a Deno or Node script without `chmod +x` or a shebang. For
production plugins, `command:` (a binary on `$PATH`) or `path:` (a
file in your repo) tend to be cleaner.

You can shape-infer a bare token in some contexts — `dv plugin invoke
./tools/dv-plugin discover` recognises the leading `./` as a path
reference. In `.dv/config.yaml` the discriminated form is required for
clarity.

## Per-package plugin assignment

The current model is **one plugin per package path**, decided by
discovery. If two plugin assignments would claim the same path, dv
halts and asks you to narrow your globs. This keeps the model simple:
every package has exactly one plugin, and that plugin owns every op
for that package.

If your repo mixes ecosystems (Deno packages + npm packages, say), you
write two plugin assignments with disjoint `match` globs — one per
ecosystem. dv merges the results; the user-visible Package list is
sorted by path, regardless of which plugin discovered each one.

## Discovery is fail-soft (where it matters)

`dv plugin list` is a read-only audit that runs discovery against every
configured plugin and shows what each one claims. A broken plugin in
one slot doesn't hide the others — you get a row per plugin, with
errors localized.

`dv plugin verify <plugin>` is the deeper, per-plugin contract check —
it runs the safe ops (`discover`, `read-version`, `finalize`) against
a real plugin and reports conformance, including a bad-input check
that's defense-in-depth against contract drift.

`dv plugin invoke <plugin> <op>` is the per-op debugger — it routes
through the same resolver and runner the real pipeline uses, so any
drift surfaces in the same place.

These three commands are the plugin DX surface. They're how you'd
develop and validate a new plugin without setting up a full repo
pipeline.

## When discovery feels weird

Two common situations:

**My package was renamed; older Records reference the old name.**
Use `dv rename <old> <new>` to record the lineage edge. The ledger
lives in `.dv/renames.yaml` (committed). Records referencing the old
name then resolve to the new package automatically. See the
[CLI reference](/reference/cli) for `dv rename`.

**A package was deleted but Records still reference it.** dv halts with
an "unresolved reference" error. Either record a rename (if it merged
into another package), or pass `--prune` to drop the stale references.

## Next

- **[Two-phase release](/concepts/two-phase-release)** — what
  `dv version` and `dv release` do once dv knows your packages.
- **[Plugin contract reference](/reference/plugin-contract)** — the
  per-op shapes, env vars, and response schemas. The detail you'd need
  to write a plugin from scratch.
- **[Config reference](/reference/config-format)** — the full
  `.dv/config.yaml` shape including discovery, history, safety, and
  more.
