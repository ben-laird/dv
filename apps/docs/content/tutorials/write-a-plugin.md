# Write a plugin

This guide walks through writing a dv plugin from scratch — what the
operations are, how to wire each one, and how to verify your plugin
without setting up a full repo pipeline. By the end you'll have a
working plugin you can drop into `.dv/config.yaml`.

For background on *why* plugins are executables and how dv finds them,
see [Packages and plugins](/concepts/packages-and-plugins). For the
exact wire format, see the [plugin contract reference](/reference/plugin-contract).

## What you're building

A dv plugin bridges dv to one ecosystem's manifest format. For this
guide we'll write one targeting **`package.json`** — the npm manifest
shape. The end product will:

- **Discover** packages by walking globs and reading `name` fields.
- **Read** versions from the `version` field.
- **Write** new versions back to the manifest.
- **Update dependency constraints** in `dependencies` /
  `devDependencies`.
- **Publish** via `npm publish` (or stub it out for now).
- **Refresh `package-lock.json`** as a finalize step.

A complete reference implementation lives in [`examples/plugins/npm/main.ts`](https://github.com/benlaird0/dv/blob/main/examples/plugins/npm/main.ts).
This guide builds the same plugin step by step so you understand
what each piece is for.

## Step 0: choose your language

dv's contract is **JSON over stdio against any executable**. You can
write a plugin in:

- A shell script (Bash + `jq` works fine for simple manifests).
- Node, Deno, Bun (typical for JS/TS ecosystems).
- Python, Ruby, Go, Rust — whatever you'd reach for normally.

We'll use **Deno** for this guide because the dv CLI itself is a Deno
program, so we know it's available. The code translates to Node
trivially — replace `Deno.env.get` with `process.env`, `Deno.readTextFile`
with `fs.readFile`, and so on.

## Step 1: the dispatcher

Every plugin is one executable that gets called with the op name as
its first argument. Start with the skeleton:

```typescript
// my-npm-plugin.ts
const op = Deno.args[0];
switch (op) {
  case "info":
    runInfo();
    break;
  case "discover":
    await runDiscover();
    break;
  case "read-version":
    await runReadVersion();
    break;
  case "write-version":
    await runWriteVersion();
    break;
  case "update-dependency":
    await runUpdateDependency();
    break;
  case "release":
    runRelease();
    break;
  case "finalize":
    await runFinalize();
    break;
  default:
    console.error(`unknown dv op: '${op ?? "<missing>"}'`);
    Deno.exit(1);
}
```

A few things to know:

- **Exit non-zero on bad input.** dv's `plugin verify` checks for this
  explicitly — invoking an op the plugin doesn't recognise must fail
  loudly, not silently succeed.
- **Write JSON to stdout for success responses.** dv parses stdout as
  JSON; anything else is a contract violation.
- **Use stderr for human logs.** dv passes stderr through to the user;
  it doesn't parse it.

## Step 2: `info` — declare your capabilities

`info` is the mandatory metadata op. dv calls it once per plugin per
run (cached) before any other op, to learn the contract version and
which ops the plugin implements.

```typescript
function runInfo(): void {
  console.log(
    JSON.stringify({
      contractVersion: "1",
      supportedOps: [
        "info",
        "discover",
        "read-version",
        "write-version",
        "update-dependency",
        "release",
        "finalize",
      ],
      name: "my-npm-plugin",
      version: "0.1.0",
    }),
  );
}
```

Three rules:

- **`contractVersion` must be the version dv expects** (currently `"1"`).
  dv passes its expected version via `DV_CONTRACT_VERSION` if you want
  to self-check; mismatches surface to the user as a clean error.
- **`supportedOps` is the truth.** Only list ops you actually implement.
  dv skips ops that aren't listed; it doesn't try them speculatively.
- **`discover` is mandatory.** A plugin that doesn't discover anything
  is useless, so it must appear in `supportedOps`. (dv verifies this.)

## Step 3: `discover` — find packages

dv passes a glob via `DV_DISCOVER_GLOB` and expects a JSON array of
packages back. Each package needs a `name` and a repo-relative `path`.

```typescript
import { expandGlob } from "jsr:@std/fs@^1/expand-glob";
import { dirname, join, relative } from "jsr:@std/path@^1";

async function runDiscover(): Promise<void> {
  const repoRoot = Deno.env.get("DV_REPO_ROOT");
  const glob = Deno.env.get("DV_DISCOVER_GLOB");
  if (!repoRoot || !glob) {
    console.error("DV_REPO_ROOT and DV_DISCOVER_GLOB are required");
    Deno.exit(1);
  }

  // Walk every package.json under the glob
  const packages: { name: string; path: string }[] = [];
  for await (const entry of expandGlob(`${glob.replace(/\/$/, "")}/package.json`, {
    root: repoRoot,
    includeDirs: false,
  })) {
    let parsed: { name?: string };
    try {
      parsed = JSON.parse(await Deno.readTextFile(entry.path));
    } catch {
      continue; // skip malformed
    }
    if (typeof parsed.name !== "string" || parsed.name.length === 0) continue;
    packages.push({
      name: parsed.name,
      path: relative(repoRoot, dirname(entry.path)),
    });
  }

  packages.sort((a, b) => a.path.localeCompare(b.path));
  console.log(JSON.stringify({ packages }));
}
```

Notes:

- **Sort the output.** dv expects byte-stable responses across runs.
- **Filter packages without a `name`.** A `package.json` without a name
  is not a publishable package — skip it silently. Same for malformed
  JSON. Don't fail the whole run because one file is broken.
- **Paths are repo-relative.** The glob comes in repo-relative;
  responses should be the same.

## Step 4: `read-version` — current version of one package

dv calls this once per package, with `DV_PACKAGE_PATH` set to the
package's directory.

```typescript
async function runReadVersion(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  if (!packagePath) {
    console.error("DV_PACKAGE_PATH is required");
    Deno.exit(1);
  }

  const manifestPath = join(packagePath, "package.json");
  const parsed = JSON.parse(await Deno.readTextFile(manifestPath));

  // A manifest without a `version` is documented as "0.0.0".
  // dv's algebra treats 0.0.0 as Unstable.
  const reportedVersion =
    typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : "0.0.0";

  console.log(JSON.stringify({ version: reportedVersion }));
}
```

The `"0.0.0"` default matters: it lets users start a package
without manually choosing an initial version. dv's first `dv version`
run will bump it to `0.0.1` (patch) or `0.1.0` (minor) based on the
Records.

## Step 5: `write-version` — set a new version

dv calls this when a package bumps. `DV_NEW_VERSION` is the SemVer
string to write.

```typescript
async function runWriteVersion(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  const newVersion = Deno.env.get("DV_NEW_VERSION");
  if (!packagePath || !newVersion) {
    console.error("DV_PACKAGE_PATH and DV_NEW_VERSION are required");
    Deno.exit(1);
  }

  const manifestPath = join(packagePath, "package.json");
  const parsed = JSON.parse(await Deno.readTextFile(manifestPath));
  parsed.version = newVersion;
  await Deno.writeTextFile(
    manifestPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
  );

  console.log(JSON.stringify({ ok: true }));
}
```

Notes:

- **Preserve other fields and their order.** Spread/parse round-trips
  keep insertion order in modern engines.
- **Use the manifest's natural formatting.** npm's `package.json`
  convention is 2-space indent + trailing newline; match it. If your
  ecosystem uses a different style (TOML, YAML), use a real parser
  that round-trips comments and formatting.

## Step 6: `update-dependency` — cascade constraints

When one package bumps, dv asks every other discovered package to
rewrite its constraint on the bumped one. This op receives a JSON
payload on **stdin** (not env vars — the only op that does):

```typescript
async function runUpdateDependency(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  if (!packagePath) {
    console.error("DV_PACKAGE_PATH is required");
    Deno.exit(1);
  }

  const stdinText = await new Response(Deno.stdin.readable).text();
  const payload: {
    dependency: string;
    new_version: string;
  } = JSON.parse(stdinText);

  const manifestPath = join(packagePath, "package.json");
  const parsed = JSON.parse(await Deno.readTextFile(manifestPath));

  // Walk every dependency field
  let rewroteAny = false;
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = parsed[field];
    if (typeof deps !== "object" || deps === null) continue;
    const original = deps[payload.dependency];
    if (typeof original !== "string") continue;

    const rewritten = rewriteConstraint(original, payload.new_version);
    if (rewritten === original) continue;
    deps[payload.dependency] = rewritten;
    rewroteAny = true;
  }

  if (!rewroteAny) {
    // No-op path: this package doesn't depend on the bumped one
    console.log(JSON.stringify({ ok: true, changed: false }));
    return;
  }

  await Deno.writeTextFile(
    manifestPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: true, changed: true }));
}

function rewriteConstraint(original: string, nextVersion: string): string {
  // Preserve the range prefix; default to caret for unrecognised forms
  const m = original.match(/^([\^~]|>=?|<=?|=)?\s*([\dA-Za-z.\-+]+)$/);
  if (m === null) return original;
  const prefix = m[1] === "" || m[1] === "=" ? "^" : (m[1] ?? "^");
  return `${prefix}${nextVersion}`;
}
```

The most important pattern here: **the cascade asks every package
about every bumped dep**. The plugin's job is to filter — if the
package doesn't list the dep, respond with `changed: false`. That's
the no-op success path, not an error.

A few extras the reference implementation handles that this skeleton
skips for brevity:

- **Non-semver constraints** — `workspace:*`, `file:...`, `git+...`,
  `http://...`, `npm:` aliases. These bail (return the original
  unchanged) because they need a human decision, not a regex rewrite.
- **Workspace vs. per-package locks** — see step 8 below.

## Step 7: `release` — publish the package

`release` fires after dv mints the git tag. Most plugins shell out
to whatever the ecosystem's publish command is:

```typescript
async function runRelease(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  if (!packagePath) {
    console.error("DV_PACKAGE_PATH is required");
    Deno.exit(1);
  }

  const result = await new Deno.Command("npm", {
    args: ["publish", "--access", "public"],
    cwd: packagePath,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!result.success) {
    const stderrText = new TextDecoder().decode(result.stderr).trim();
    // ok:false is a VALID response shape for release — it means
    // "publish failed but don't roll back the tag." dv aggregates
    // these into the per-package outcome summary.
    console.log(
      JSON.stringify({
        ok: false,
        message: `npm publish failed: ${stderrText}`,
      }),
    );
    return;
  }

  console.log(JSON.stringify({ ok: true, published: true }));
}
```

The `release` op is **the only op where `ok: false` is a normal
response**, not an error. dv treats publish failures as data: the
tag stays, the per-package outcome is recorded, the run continues,
and the user can re-run `dv release --force` to retry.

Don't `Deno.exit(1)` on a publish failure — that turns a recoverable
data condition into a hard plugin error and dv won't know which
packages failed vs. which succeeded.

## Step 8: `finalize` — refresh companion files

After all `write-version` and `update-dependency` calls settle, dv
fires `finalize` once per plugin. This is where you refresh
generated files (lockfiles, etc.) so they ship in the same commit
as the manifest edits.

```typescript
async function runFinalize(): Promise<void> {
  const repoRoot = Deno.env.get("DV_REPO_ROOT");
  if (!repoRoot) {
    console.log(JSON.stringify({ ok: false, error: "DV_REPO_ROOT required" }));
    Deno.exit(1);
  }

  const lockfilePath = join(repoRoot, "package-lock.json");
  const before = await readOrUndefined(lockfilePath);

  // Refresh the lockfile against the current manifests without
  // installing to node_modules
  const result = await new Deno.Command("npm", {
    args: ["install", "--package-lock-only", "--silent"],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    console.log(
      JSON.stringify({
        ok: false,
        error: `npm install --package-lock-only failed: ${stderr}`,
      }),
    );
    Deno.exit(1);
  }

  const after = await readOrUndefined(lockfilePath);
  const changed = before !== after ? ["package-lock.json"] : [];

  console.log(
    JSON.stringify({
      ok: true,
      additionalChangedFiles: changed,
      message: changed.length > 0 ? "refreshed lockfile" : "lockfile unchanged",
    }),
  );
}

async function readOrUndefined(p: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(p);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}
```

A few patterns worth knowing:

- **Snapshot before / compare after.** Reporting a file as "changed"
  only when its content actually changed avoids empty-diff commits.
- **Report repo-relative paths** in `additionalChangedFiles`. dv
  stages exactly those paths into the commit.
- **Per-package vs. workspace lockfiles.** npm workspaces have one
  root `package-lock.json`; non-workspace setups have one per
  package. The reference plugin checks the root `package.json` for
  a `workspaces` field and picks accordingly. This skeleton only
  handles the workspace case.

## Step 9: try it out

Write the file as `my-npm-plugin.ts` and wire it into a test repo:

```sh
# In your test repo:
mkdir -p .dv
cat > .dv/config.yaml <<'EOF'
discovery:
  plugins:
    - match: ["packages/*"]
      use:
        run: deno run -A ./my-npm-plugin.ts
EOF
```

Then exercise it. Three commands are your friends:

### `dv plugin verify` — contract conformance

```sh
$ dv plugin verify "run:deno run -A ./my-npm-plugin.ts"

  ✓ info  contractVersion=1, 7 ops declared (my-npm-plugin 0.1.0)
  ✓ discover  0 packages returned for glob '*'
  · read-version  discover returned no packages — pass `--glob` so verify can exercise read-version against a real package
  · write-version  side-effectful — exercise with `dv plugin invoke`
  · update-dependency  side-effectful — exercise with `dv plugin invoke`
  · release  side-effectful — exercise with `dv plugin invoke`
  ✓ finalize  no-op run reported 0 additional files
  ✓ bad-input rejects  exited non-zero for unknown op '__dv_plugin_verify_bogus__'

PASS  4 passed, 0 failed, 4 skipped
```

Verify is your CI-side gate. It exercises the safe ops (`info`,
`discover`, `read-version`, `finalize`, bad-input check) and reports
side-effectful ops as `skipped` — those need real fixtures, which is
what `dv plugin invoke` is for.

### `dv plugin invoke` — exercise one op

To test side-effectful ops against a controlled fixture:

```sh
# Set up a tiny package.json fixture
mkdir -p /tmp/fixture/packages/alpha
echo '{"name":"@x/alpha","version":"1.2.3"}' > /tmp/fixture/packages/alpha/package.json

# Discover
$ dv plugin invoke "run:deno run -A ./my-npm-plugin.ts" discover \
    --repo-root /tmp/fixture --glob 'packages/*'
← stdout: {"packages":[{"name":"@x/alpha","path":"packages/alpha"}]}
✓ valid discover response (1 package)

# Write a new version
$ dv plugin invoke "run:deno run -A ./my-npm-plugin.ts" write-version \
    --repo-root /tmp/fixture --package "@x/alpha" \
    --path /tmp/fixture/packages/alpha --new-version "1.3.0"
← stdout: {"ok":true}
✓ valid write-version response (ok=true)

$ cat /tmp/fixture/packages/alpha/package.json
{
  "name": "@x/alpha",
  "version": "1.3.0"
}
```

`dv plugin invoke` routes through the *same* `resolvePlugin` +
`invokeOp` + per-op parser pipeline that `dv version` uses. Any
contract drift surfaces here, not later.

### `--debug` — see what dv sends

If a plugin's behaving weirdly, add `--debug` to any dv command:

```sh
$ dv version --dry-run --debug

[dv:debug] ▶ discover via deno run -A ./my-npm-plugin.ts
  exec: deno run -A ./my-npm-plugin.ts discover
  env: DV_DISCOVER_GLOB=packages/* DV_OPERATION=discover DV_REPO_ROOT=/repo
  stdin: (none)
  timeout: 60000ms
[dv:debug] ✓ discover (32ms)
  exit: 0
  stdout: {"packages":[{"name":"@x/alpha","path":"packages/alpha"}]}
  stderr: (empty)
```

You see every invocation — op, env vars dv set, stdin payload (if
any), stdout, stderr, exit code, duration. This is the answer to
"why did my plugin fail inside `dv version`."

## What to test on your own plugin

A few things to check before declaring a plugin "done":

- [ ] **Discovery returns sorted, deduplicated results.** Run discover
      twice; the output should be byte-identical.
- [ ] **Read-version handles the "no version field" case** with `"0.0.0"`.
- [ ] **Write-version preserves other fields.** Round-trip a manifest
      with several fields; only `version` should change.
- [ ] **Update-dependency handles every dependency field your ecosystem
      uses.** For npm: `dependencies`, `devDependencies`,
      `peerDependencies`, `optionalDependencies`.
- [ ] **Update-dependency returns `changed: false` when the dep isn't
      listed.** This is the cascade no-op path; getting it wrong means
      the cascade fails for unrelated packages.
- [ ] **Release returns `ok: false` (not exit 1) on publish failure.**
      `ok: false` is data; exit 1 is an error.
- [ ] **Finalize doesn't run the actual install** (just the
      lockfile-only mode). A full install in a CI release pass is
      slow and unnecessary.
- [ ] **Unknown ops exit non-zero.** dv's verify checks this
      explicitly.

## Where to go from here

- **Adapt the reference implementation.** [`examples/plugins/npm/main.ts`](https://github.com/benlaird0/dv/blob/main/examples/plugins/npm/main.ts)
  has the full version with edge cases. Copy it, change what you
  need, own it. It's a starting point, not a maintained dependency.
- **Read the [plugin contract reference](/reference/plugin-contract).**
  This guide builds intuition; the reference is the authoritative
  spec for every env var, every response shape, every error
  condition.
- **[Packages and plugins](/concepts/packages-and-plugins)** —
  background on the model and where plugins fit.
