// Example dv plugin for Deno workspaces. Single-file dispatcher
// wired in via the `run:` plugin reference arm:
//
//   discovery:
//     plugins:
//       - match: ["apps/*", "packages/*"]
//         use:
//           run: deno run -A ./examples/plugins/deno/main.ts
//
// Switches on Deno.args[0] to route to the per-Op handler. JSON-
// over-stdio per specs/plugin-contract.md. Copy this whole file
// into your own repo, adapt as needed — it is not a maintained
// dependency (`examples/CLAUDE.md`).
//
// Why one file instead of five executables: the `run:` arm lets
// dv invoke the script via `deno run`, so there's no shebang and
// no `chmod +x` to maintain. One file per language is the simple
// shape; per-Op functions inside it stay small and focused.

import { expandGlob } from "jsr:@std/fs@^1/expand-glob";
import { parse as parseJsonc } from "jsr:@std/jsonc@^1";
import { dirname, join, relative } from "jsr:@std/path@^1";

// Entry point, run at the bottom of the file once every declaration
// is initialized. Guarded by import.meta.main so the tests can import
// helpers without dispatching an op.
async function main(): Promise<void> {
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
    case "get-dependencies":
      await runGetDependencies();
      break;
    case "release":
      await runRelease();
      break;
    case "finalize":
      await runFinalize();
      break;
    default:
      console.error(`unknown dv op: '${op ?? "<missing>"}'`);
      Deno.exit(1);
  }
}

// === info ======================================================

// Mandatory. dv invokes this once per plugin per run (cached) to
// learn the contract version and op set. The contract version must
// match what dv expects (passed via DV_CONTRACT_VERSION); op names
// must appear in supportedOps for dv to invoke them.
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
        "get-dependencies",
        "release",
        "finalize",
      ],
      name: "deno",
      version: "0.2.0",
    }),
  );
}

// === discover ==================================================

async function runDiscover(): Promise<void> {
  const repoRoot = Deno.env.get("DV_REPO_ROOT");
  const glob = Deno.env.get("DV_DISCOVER_GLOB");
  if (!repoRoot || !glob) {
    console.error("DV_REPO_ROOT and DV_DISCOVER_GLOB are required");
    Deno.exit(1);
  }
  const packages: { name: string; path: string }[] = [];
  for await (const entry of expandGlob(glob.replace(/\/$/, ""), {
    root: repoRoot,
    includeDirs: true,
  })) {
    if (!entry.isDirectory) continue;
    const manifest = await readManifest(entry.path);
    // Directories without a (parseable) manifest aren't packages.
    if (!manifest.ok) continue;
    const name = manifest.value.parsed.name;
    if (typeof name !== "string" || name.length === 0) continue;
    packages.push({ name, path: relative(repoRoot, entry.path) });
  }
  packages.sort((a, b) => a.path.localeCompare(b.path));
  console.log(JSON.stringify({ packages }));
}

// === read-version ==============================================

async function runReadVersion(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  if (!packagePath) {
    console.error("DV_PACKAGE_PATH is required");
    Deno.exit(1);
  }
  const manifest = await readManifest(packagePath);
  if (!manifest.ok) failWith(manifest.error);
  // Manifests without a `version` field report 0.0.0 — the
  // documented "no version yet" default. dv's algebra treats
  // 0.0.0 as Unstable.
  const version = manifest.value.parsed.version;
  let reportedVersion = "0.0.0";
  if (typeof version === "string" && version.length > 0) {
    reportedVersion = version;
  }
  console.log(JSON.stringify({ version: reportedVersion }));
}

// === write-version =============================================

// Edits the `version` value in place in the manifest's original
// text, so tabs, blank-line grouping, key order, and (in
// deno.jsonc) comments survive byte-for-byte. Re-serializing with
// JSON.stringify would reformat the whole file and fail a repo's
// fmt gate on the release commit.
async function runWriteVersion(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  const newVersion = Deno.env.get("DV_NEW_VERSION");
  if (!packagePath || !newVersion) {
    console.error("DV_PACKAGE_PATH and DV_NEW_VERSION are required");
    Deno.exit(1);
  }
  const manifest = await readManifest(packagePath);
  if (!manifest.ok) failWith(manifest.error);
  const edited = setManifestString({
    text: manifest.value.text,
    path: ["version"],
    value: newVersion,
  });
  if (!edited.ok) {
    failWith(`cannot edit ${manifest.value.path}: ${edited.error}`);
  }
  await Deno.writeTextFile(manifest.value.path, edited.value);
  console.log(JSON.stringify({ ok: true }));
}

// === update-dependency =========================================

async function runUpdateDependency(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  if (!packagePath) {
    console.error("DV_PACKAGE_PATH is required");
    Deno.exit(1);
  }
  // update-dependency receives a stdin payload (the dependency name
  // + new version). The plugin runner sets stdin to "null" for ops
  // without a payload, so we only read stdin on ops that expect it.
  const payload = await readStdinJson();
  if (!payload.ok) failWith(payload.error);
  const payloadFields = isRecord(payload.value) ? payload.value : {};
  const dependencyName = payloadFields.dependency;
  const newVersion = payloadFields.new_version;
  if (typeof dependencyName !== "string" || typeof newVersion !== "string") {
    failWith("stdin payload missing `dependency` or `new_version`");
  }
  const manifest = await readManifest(packagePath);
  if (!manifest.ok) failWith(manifest.error);
  const rawImports = manifest.value.parsed.imports;
  const importsMap = isRecord(rawImports) ? rawImports : {};
  const originalSpecifier = importsMap[dependencyName];
  if (typeof originalSpecifier !== "string") {
    // No-op path of the cascade: this dependent doesn't import the
    // bumped package through its import map. dv's plan-builder
    // reports the cross product; the plugin filters here.
    console.log(JSON.stringify({ ok: true, changed: false }));
    return;
  }
  const rewrittenSpecifier = rewriteSpecifierVersion({
    originalSpecifier,
    nextVersion: newVersion,
  });
  if (rewrittenSpecifier === originalSpecifier) {
    console.log(JSON.stringify({ ok: true, changed: false }));
    return;
  }
  const edited = setManifestString({
    text: manifest.value.text,
    path: ["imports", dependencyName],
    value: rewrittenSpecifier,
  });
  if (!edited.ok) {
    failWith(`cannot edit ${manifest.value.path}: ${edited.error}`);
  }
  await Deno.writeTextFile(manifest.value.path, edited.value);
  console.log(JSON.stringify({ ok: true, changed: true }));
}

// Preserves the (jsr:|npm:)?@scope/name prefix and the original
// range prefix (`^`, `~`, exact). Default for unrecognized forms is
// caret — the modern Deno/JS convention. Returning the original
// unchanged on total parse failure is intentional: the cascade
// reports changed:false rather than failing the run, so the user
// can hand-fix odd manifest shapes without the plugin guessing.
//
// Alternative: Deno 2.8+ ships `deno bump-version --import-map`,
// which rewrites jsr: constraints across the whole workspace import
// map in one pass (see deno.com/blog/v2.8). dv already handles this
// per-dependency here, so it isn't needed — but if you'd rather lean
// on Deno's native rewriter, that's the hook. Use ONLY its
// --import-map syncing: its increment (`patch`/`minor`/`major`) and
// commit-derived modes compute bumps from git history, which is the
// one thing dv owns and must not delegate (Records, not commits, are
// authoritative — specs/design.md § Records over commit messages).
function rewriteSpecifierVersion({
  originalSpecifier,
  nextVersion,
}: {
  originalSpecifier: string;
  nextVersion: string;
}): string {
  const matchedPattern = originalSpecifier.match(
    /^((?:jsr:|npm:)?@?[\w./-]+)@([\^~]?)([\dA-Za-z.\-+]+)$/,
  );
  if (matchedPattern === null) return originalSpecifier;
  const prefixBeforeAt = matchedPattern[1];
  const rangePrefix = matchedPattern[2];
  // Default to caret for unrecognized prefixes (covers the empty-
  // prefix "exact pin" case too — we widen to caret since dv
  // versions are semantically a moving target).
  const keepsRangePrefix = rangePrefix === "^" || rangePrefix === "~";
  const preservedPrefix = keepsRangePrefix ? rangePrefix : "^";
  return `${prefixBeforeAt}@${preservedPrefix}${nextVersion}`;
}

// === get-dependencies ==========================================

// Reports which OTHER discovered packages this one depends on, so
// `dv release` can publish dependencies before their dependents
// (JSR rejects publishes that reference unpublished imports).
//
// Two sources, unioned:
//
// 1. The manifest's `imports` map. Each key is the bare specifier
//    the package imports under — often the package name itself
//    (`"@scope/clipc": "jsr:@scope/clipc@^0.3.0"`).
// 2. The module graph. Deno workspace members import each other by
//    name WITHOUT an `imports` entry; the workspace resolves them.
//    `deno info --json` on each `exports` entry point lists every
//    local file the package loads (transitively); a file that sits
//    inside another member's directory makes that member a
//    dependency. `--no-remote --no-npm --no-lock` keeps this an
//    offline, read-only walk: registry modules are skipped (they
//    are never workspace members) and deno.lock is never written.
//    If the package's graph can't be built, the op warns on stderr
//    and falls back to source 1 alone; if deno itself is missing or
//    misbehaves, the op fails.
//
// Only names in `candidates` are reported; external deps
// (registry packages, std-lib) don't affect publish ordering.

async function runGetDependencies(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  if (!packagePath) {
    console.error("DV_PACKAGE_PATH is required");
    Deno.exit(1);
  }
  // get-dependencies reads `candidates` from stdin so the plugin
  // can scope its match without re-running discovery. dv passes
  // every OTHER discovered package's name; we return the subset
  // this package depends on.
  const payload = await readStdinJson();
  if (!payload.ok) failWith(payload.error);
  const payloadFields = isRecord(payload.value) ? payload.value : {};
  const candidates = payloadFields.candidates;
  if (!Array.isArray(candidates)) {
    failWith("stdin payload missing `candidates` array");
  }
  const candidateSet = new Set<string>(
    candidates.filter(
      (candidate): candidate is string => typeof candidate === "string",
    ),
  );

  const manifest = await readManifest(packagePath);
  if (!manifest.ok) failWith(manifest.error);
  const dependencies = new Set<string>();
  // Nothing can match an empty candidate set; skip the graph walk.
  if (candidateSet.size > 0) {
    const importsMap = manifest.value.parsed.imports;
    for (const importKey of Object.keys(
      isRecord(importsMap) ? importsMap : {},
    )) {
      if (candidateSet.has(importKey)) dependencies.add(importKey);
    }
    const graphPackages = await packagesInModuleGraph({
      packageDir: packagePath,
      exports: manifest.value.parsed.exports,
    });
    if (graphPackages.ok) {
      for (const packageName of graphPackages.value) {
        if (candidateSet.has(packageName)) dependencies.add(packageName);
      }
    } else if (graphPackages.error.kind === "graph-unavailable") {
      // A graph this package can't produce (say, an entry point that
      // is a gitignored generated file) degrades to the import-map
      // answer instead of aborting the release. stderr is free-form
      // diagnostics, passed through to the user.
      const packageName = Deno.env.get("DV_PACKAGE_NAME") ?? packagePath;
      console.error(
        `warning: ${packageName}: module graph unavailable, reporting import-map dependencies only (${graphPackages.error.reason})`,
      );
    } else {
      failWith(graphPackages.error.reason);
    }
  }
  console.log(
    JSON.stringify({ ok: true, dependencies: [...dependencies].sort() }),
  );
}

// Names of the packages owning every local module reachable from
// the package's export entry points. Exported (with an injectable
// budget) so the tests can exercise the deadline quickly.
export async function packagesInModuleGraph({
  packageDir,
  exports,
  budgetMs = MODULE_GRAPH_BUDGET_MS,
}: {
  packageDir: string;
  exports: unknown;
  budgetMs?: number;
}): Promise<Result<Set<string>, GraphFailure>> {
  // One deadline for the whole walk, however many entry points the
  // package exports. When it fires, any `deno info` still running is
  // killed.
  const deadline = AbortSignal.timeout(budgetMs);
  const ownerNames = new Set<string>();
  const ownerNameByDir = new Map<string, string | undefined>();
  for (const entryPoint of exportEntryPoints(exports)) {
    const localModules = await localModulesOf({
      packageDir,
      entryPoint,
      deadline,
      budgetMs,
    });
    if (!localModules.ok) return localModules;
    for (const modulePath of localModules.value) {
      const ownerName = await owningPackageName({
        modulePath,
        ownerNameByDir,
      });
      if (ownerName !== undefined) ownerNames.add(ownerName);
    }
  }
  return { ok: true, value: ownerNames };
}

// dv kills get-dependencies after 60s (a fixed timeout in dv
// release), and that limit covers the whole plugin process: Deno
// startup, reading stdin and the manifest, then this walk. 45s for
// the walk leaves the rest of the op 15s of headroom.
const MODULE_GRAPH_BUDGET_MS = 45_000;

// `exports` is either one path or a map of subpath → path.
function exportEntryPoints(exports: unknown): string[] {
  if (typeof exports === "string") return [exports];
  if (!isRecord(exports)) return [];
  return Object.values(exports).filter(
    (entryPoint): entryPoint is string => typeof entryPoint === "string",
  );
}

// Runs `deno info --json` from the package directory (so the
// workspace config resolves member names) and returns the file
// path of every local module in the graph.
async function localModulesOf({
  packageDir,
  entryPoint,
  deadline,
  budgetMs,
}: {
  packageDir: string;
  entryPoint: string;
  deadline: AbortSignal;
  budgetMs: number;
}): Promise<Result<string[], GraphFailure>> {
  const infoRun = await runDenoBefore({
    args: [
      "info",
      "--json",
      "--no-remote",
      "--no-npm",
      "--no-lock",
      entryPoint,
    ],
    cwd: packageDir,
    deadline,
  });
  if (infoRun.kind === "timed-out") {
    return graphUnavailable(
      `deno info ${entryPoint} ran past the ${budgetMs}ms budget`,
    );
  }
  if (infoRun.kind === "spawn-failed") {
    return denoInfoBroken(`cannot run deno info: ${infoRun.reason}`);
  }
  if (infoRun.code !== 0) {
    return graphUnavailable(
      `deno info ${entryPoint} failed (exit ${infoRun.code}): ${infoRun.stderr.trim() || "<no stderr>"}`,
    );
  }
  let graph: unknown;
  try {
    graph = JSON.parse(infoRun.stdout);
  } catch (caughtError) {
    return denoInfoBroken(
      `deno info ${entryPoint} printed invalid JSON: ${describeError(caughtError)}`,
    );
  }
  const modules = isRecord(graph) ? graph.modules : undefined;
  // A successful run always lists at least the entry point itself.
  if (!Array.isArray(modules) || modules.length === 0) {
    return denoInfoBroken(`deno info ${entryPoint} listed no modules`);
  }
  const localPaths: string[] = [];
  for (const graphModule of modules) {
    if (!isRecord(graphModule)) continue;
    // Remote modules error by design under --no-remote; a LOCAL
    // module that fails to load means the graph is incomplete.
    const { specifier, error, local } = graphModule;
    if (
      typeof error === "string" &&
      typeof specifier === "string" &&
      specifier.startsWith("file:")
    ) {
      return graphUnavailable(`deno info ${entryPoint}: ${error}`);
    }
    if (typeof local === "string") localPaths.push(local);
  }
  return { ok: true, value: localPaths };
}

// Why the module graph couldn't be read. `graph-unavailable` is a
// fact about this package (an entry point won't load, the walk ran
// out of time): the op falls back to the import map. `deno-info-broken`
// means the tool itself misbehaved (deno missing, output that isn't
// the expected JSON); guessing past that would hide a broken setup.
type GraphFailure =
  | { kind: "graph-unavailable"; reason: string }
  | { kind: "deno-info-broken"; reason: string };
// {}

function graphUnavailable(reason: string): Result<never, GraphFailure> {
  return { ok: false, error: { kind: "graph-unavailable", reason } };
}

function denoInfoBroken(reason: string): Result<never, GraphFailure> {
  return { ok: false, error: { kind: "deno-info-broken", reason } };
}

type DenoRun =
  | { kind: "exited"; code: number; stdout: string; stderr: string }
  | { kind: "timed-out" }
  | { kind: "spawn-failed"; reason: string };
// {}

// Runs `deno <args>` and returns its output, unless `deadline` fires
// first. Then the child is SIGKILLed and its pipes abandoned rather
// than drained: a wrapper script standing in for `deno` that doesn't
// exec can leave a grandchild holding them open long after the kill.
async function runDenoBefore({
  args,
  cwd,
  deadline,
}: {
  args: string[];
  cwd: string;
  deadline: AbortSignal;
}): Promise<DenoRun> {
  if (deadline.aborted) return { kind: "timed-out" };
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("deno", {
      args,
      cwd,
      // Plain-text errors: they end up in our error/warning messages.
      env: { NO_COLOR: "1" },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (caughtError) {
    return { kind: "spawn-failed", reason: describeError(caughtError) };
  }
  const stdoutReader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();
  const finished = Promise.all([
    child.status,
    readAllText(stdoutReader),
    readAllText(stderrReader),
  ]);
  let onAbort = (): void => {};
  const timedOut = new Promise<"timed-out">((resolve) => {
    onAbort = () => resolve("timed-out");
    deadline.addEventListener("abort", onAbort, { once: true });
  });
  const winner = await Promise.race([finished, timedOut]);
  // A listener keeps the deadline's timer alive; drop it so the plugin
  // can exit as soon as the op is done.
  deadline.removeEventListener("abort", onAbort);
  if (winner === "timed-out") {
    try {
      child.kill("SIGKILL");
    } catch {
      // The child exited between the deadline and the kill.
    }
    await Promise.allSettled([
      stdoutReader.cancel(),
      stderrReader.cancel(),
      child.status,
    ]);
    return { kind: "timed-out" };
  }
  const [status, stdout, stderr] = winner;
  return { kind: "exited", code: status.code, stdout, stderr };
}

async function readAllText(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
  }
}

// The `name` of the nearest NAMED manifest at or above the module's
// directory — the workspace member that owns the file. A nameless
// deno.json on the way up (a nested tool config, the workspace root)
// is not a package, so the walk keeps climbing past it. Memoized per
// directory since a graph revisits the same folders constantly.
async function owningPackageName({
  modulePath,
  ownerNameByDir,
}: {
  modulePath: string;
  ownerNameByDir: Map<string, string | undefined>;
}): Promise<string | undefined> {
  const visitedDirs: string[] = [];
  let currentDir = dirname(modulePath);
  let ownerName: string | undefined;
  while (true) {
    if (ownerNameByDir.has(currentDir)) {
      ownerName = ownerNameByDir.get(currentDir);
      break;
    }
    visitedDirs.push(currentDir);
    const manifest = await readManifest(currentDir);
    // Deliberately lenient: an unparseable manifest here can't name an
    // owner, so it is climbed past like a nameless one. Ownership only
    // decides publish order, and the member's own ops report the parse
    // error where it matters.
    const name = manifest.ok ? manifest.value.parsed.name : undefined;
    if (typeof name === "string" && name.length > 0) {
      ownerName = name;
      break;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  for (const visitedDir of visitedDirs) {
    ownerNameByDir.set(visitedDir, ownerName);
  }
  return ownerName;
}

// === release ===================================================

// Publishes the package to JSR with `deno publish`, run from the
// package directory so it reads that member's manifest. This is the
// publisher dv uses for its own releases, lifted in so the example
// works on a real repo. Swap the command for `npm publish`,
// `gh release create`, etc. if your registry differs.
//
// Env vars dv sets for this op:
//   DV_REPO_ROOT    — absolute path to repo root
//   DV_PACKAGE_NAME — package name from discover
//   DV_PACKAGE_PATH — directory of this package
//   DV_NEW_VERSION  — the version just tagged
//   DV_GIT_TAG      — the tag string that was minted
//
// Credentials: no --token is passed. On a GitHub Actions workflow
// that JSR trusts, `deno publish` picks up OIDC credentials on its
// own; elsewhere, set up auth the way `deno publish` documents.
//
// Return shape (apps/cli/schemas/plugin-responses.json):
//   { ok, published?, skipped?, message? }
//
// Per specs/plugin-contract.md, a release-op failure does NOT roll
// back the tag. A failed publish is data, not a crash: respond
// `{ ok: false, message }` and exit 0, so dv records the outcome,
// continues with the other packages, and `dv release --force` can
// retry once the cause is fixed. dv bounds this op with
// `publishing.timeout`.

async function runRelease(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  const packageName = Deno.env.get("DV_PACKAGE_NAME") ?? "<unknown>";
  const newVersion = Deno.env.get("DV_NEW_VERSION") ?? "<unknown>";
  if (!packagePath) failWith("DV_PACKAGE_PATH is required");

  // `"publish": false` is Deno's own marker for a workspace member
  // that never goes to JSR (an app, an internal tool). dv still
  // versions and tags it; the plugin just has nothing to publish.
  const manifest = await readManifest(packagePath);
  if (!manifest.ok) failWith(manifest.error);
  if (manifest.value.parsed.publish === false) {
    console.log(
      JSON.stringify({
        ok: true,
        published: false,
        message: `${packageName}@${newVersion} not published: "publish": false in ${manifest.value.path}`,
      }),
    );
    return;
  }

  // --allow-dirty: dv has written the version commit and tag, but
  // the tree may still carry unrelated changes (e.g. CI artifacts).
  // Its stdout/stderr are piped into this process, never straight to
  // dv; --quiet drops progress chatter so the stderr we quote in a
  // failure message is just the error.
  let publishResult: Deno.CommandOutput;
  try {
    publishResult = await new Deno.Command("deno", {
      args: ["publish", "--allow-dirty", "--quiet"],
      cwd: packagePath,
      // Deno colours stderr even when piped; keep escape codes out of
      // the message dv records and prints with --json.
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (caughtError) {
    console.log(
      JSON.stringify({
        ok: false,
        message: `cannot run deno publish: ${describeError(caughtError)}`,
      }),
    );
    return;
  }
  if (!publishResult.success) {
    const stderrText = new TextDecoder().decode(publishResult.stderr).trim();
    console.log(
      JSON.stringify({
        ok: false,
        message: `deno publish failed for ${packageName}@${newVersion} (exit ${publishResult.code}): ${stderrText || "<no stderr>"}`,
      }),
    );
    return;
  }
  console.log(
    JSON.stringify({
      ok: true,
      published: true,
      message: `published ${packageName}@${newVersion} to JSR`,
    }),
  );
}

// === finalize ==================================================

// Fires once per plugin after every write-version + cascade
// update-dependency call has completed, before dv stages + commits.
// We refresh deno.lock so it ships with the manifest edits in the
// same commit (otherwise the next deno-anything command would
// dirty the user's tree).
//
// Env vars dv sets for this op:
//   DV_REPO_ROOT            — absolute path to repo root
//   DV_FINALIZE_TRIGGER     — "version" or "v1"
//   DV_BUMPED_PACKAGES      — JSON array of {name, path, new_version}
//                             entries for packages this plugin
//                             governs that bumped this run
//
// Return shape (apps/cli/schemas/plugin-responses.json):
//   { ok, unsupported?, additionalChangedFiles?, message? }

async function runFinalize(): Promise<void> {
  const repoRoot = Deno.env.get("DV_REPO_ROOT");
  if (!repoRoot) {
    console.log(
      JSON.stringify({ ok: false, error: "DV_REPO_ROOT is required" }),
    );
    Deno.exit(1);
  }

  // Snapshot deno.lock's content before the refresh purely to phrase
  // the human message ("refreshed" vs "already up to date"). It is NOT
  // the staging signal — see below.
  const lockfilePath = join(repoRoot, "deno.lock");
  const lockfileBefore = await readFileOrUndefined(lockfilePath);

  // `deno install` (no args) refreshes the lockfile against the
  // current manifests. Its output is piped, not passed to dv; --quiet
  // keeps the stderr we quote on failure down to the error itself.
  const installResult = await new Deno.Command("deno", {
    args: ["install", "--quiet"],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!installResult.success) {
    const stderrText = new TextDecoder().decode(installResult.stderr).trim();
    console.log(
      JSON.stringify({
        ok: false,
        error: `deno install failed (exit ${installResult.code}): ${stderrText || "<no stderr>"}`,
      }),
    );
    Deno.exit(1);
  }

  const lockfileAfter = await readFileOrUndefined(lockfilePath);
  const installMovedLockfile = lockfileBefore !== lockfileAfter;

  // Report deno.lock if it differs from its committed (HEAD) state —
  // NOT merely if *this* install moved bytes. The lockfile can drift
  // out of sync via deno tooling that ran earlier in the same session
  // (a warm-cache `deno check`/`test`, or even dv's own `deno run`
  // startup); that drift is invisible to a before/after-install diff
  // but still must ship in the version commit. Reporting against HEAD
  // closes that blind spot while staying churn-free for an in-sync lock.
  const lockfileDiffersFromHead = await differsFromHead({
    repoRoot,
    relativePath: "deno.lock",
  });
  const additionalChangedFiles = lockfileDiffersFromHead ? ["deno.lock"] : [];
  let message = "deno.lock already up to date";
  if (lockfileDiffersFromHead) {
    if (installMovedLockfile) {
      message = "refreshed deno.lock";
    } else {
      message = "deno.lock was out of sync with HEAD";
    }
  }
  console.log(JSON.stringify({ ok: true, additionalChangedFiles, message }));
}

// True if `relativePath` differs from its committed (HEAD) content.
// Uses `git status --porcelain` (not `git diff HEAD`) so untracked,
// modified, AND staged all count — a first-release lockfile that has
// never been committed is untracked, which `git diff HEAD` would miss.
// Any non-empty porcelain line for the path means it must ship.
async function differsFromHead(args: {
  repoRoot: string;
  relativePath: string;
}): Promise<boolean> {
  const statusResult = await new Deno.Command("git", {
    args: [
      "-C",
      args.repoRoot,
      "status",
      "--porcelain",
      "--",
      args.relativePath,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!statusResult.success) return true; // fail safe toward staging
  return new TextDecoder().decode(statusResult.stdout).trim().length > 0;
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return undefined;
    throw caughtError;
  }
}

// === shared helpers ============================================

// Errors are values: fallible helpers return a Result instead of
// throwing, and the op handlers turn an error into the contract's
// `{ ok: false, error }` response.
type Result<Value, Failure = string> =
  | { ok: true; value: Value }
  | { ok: false; error: Failure };
// {}

// Reports a contract error response and exits non-zero.
function failWith(error: string): never {
  console.log(JSON.stringify({ ok: false, error }));
  Deno.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(caughtError: unknown): string {
  if (caughtError instanceof Error) return caughtError.message;
  return String(caughtError);
}

async function readStdinJson(): Promise<Result<unknown>> {
  const stdinText = await new Response(Deno.stdin.readable).text();
  try {
    return { ok: true, value: JSON.parse(stdinText) };
  } catch (caughtError) {
    return {
      ok: false,
      error: `stdin not valid JSON: ${describeError(caughtError)}`,
    };
  }
}

// A package manifest: Deno reads `deno.json` first, then
// `deno.jsonc`. `text` is kept so edits can splice into it.
interface Manifest {
  path: string;
  text: string;
  parsed: Record<string, unknown>;
}

async function readManifest(packageDir: string): Promise<Result<Manifest>> {
  for (const fileName of ["deno.json", "deno.jsonc"]) {
    const path = join(packageDir, fileName);
    const text = await readFileOrUndefined(path);
    if (text === undefined) continue;
    const parsed = parseManifestText(text);
    if (!parsed.ok) {
      return { ok: false, error: `cannot parse ${path}: ${parsed.error}` };
    }
    return { ok: true, value: { path, text, parsed: parsed.value } };
  }
  return {
    ok: false,
    error: `no deno.json or deno.jsonc in ${packageDir}`,
  };
}

// deno.json is parsed as JSONC too — Deno itself accepts comments
// and trailing commas in both file names.
function parseManifestText(text: string): Result<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (caughtError) {
    return { ok: false, error: describeError(caughtError) };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "top level is not an object" };
  }
  return { ok: true, value: parsed };
}

// === surgical manifest edits ===================================

// Sets the string at `path` (e.g. ["version"] or ["imports", "@a/b"])
// by splicing a new JSON string literal over the old one in `text`.
// Everything else stays byte-identical. A missing final key is
// inserted next to its siblings, copying their indentation. The
// result is re-parsed to prove the edit is valid and landed. With
// duplicate keys the LAST one is edited: it is the one parsers keep.
function setManifestString({
  text,
  path,
  value,
}: {
  text: string;
  path: string[];
  value: string;
}): Result<string> {
  const root = scanJsonc(text);
  if (root.kind !== "object") {
    return { ok: false, error: "top level is not an object" };
  }
  let container = root;
  for (const key of path.slice(0, -1)) {
    const child = container.members.findLast((member) => member.key === key);
    if (child === undefined || child.value.kind !== "object") {
      return { ok: false, error: `\`${key}\` is not an object` };
    }
    container = child.value;
  }
  const finalKey = path[path.length - 1];
  if (finalKey === undefined) {
    return { ok: false, error: "empty manifest path" };
  }
  const literal = JSON.stringify(value);
  const existing = container.members.findLast(
    (member) => member.key === finalKey,
  );
  let edited: string;
  if (existing === undefined) {
    edited = insertMember({ text, container, key: finalKey, literal });
  } else if (existing.value.kind !== "string") {
    return { ok: false, error: `\`${path.join(".")}\` is not a string` };
  } else {
    const { start, end } = existing.value.span;
    edited = text.slice(0, start) + literal + text.slice(end);
  }
  return verifyEdit({ edited, path, value });
}

// Inserts `"key": literal` after the `name` member (where `version`
// conventionally sits) or else after the last member, reusing the
// whitespace that precedes that member's key as the separator.
function insertMember({
  text,
  container,
  key,
  literal,
}: {
  text: string;
  container: JsoncObject;
  key: string;
  literal: string;
}): string {
  const member = `${JSON.stringify(key)}: ${literal}`;
  const nameMember = container.members.findLast(
    (candidate) => candidate.key === "name",
  );
  const anchor = nameMember ?? container.members.at(-1);
  if (anchor === undefined) {
    const openingBrace = container.span.start + 1;
    return `${text.slice(0, openingBrace)} ${member} ${text.slice(container.span.end - 1)}`;
  }
  let separatorStart = anchor.keySpan.start;
  while (separatorStart > 0 && /\s/.test(text.charAt(separatorStart - 1))) {
    separatorStart -= 1;
  }
  const separator = text.slice(separatorStart, anchor.keySpan.start) || " ";
  const insertAt = anchor.value.span.end;
  return `${text.slice(0, insertAt)},${separator}${member}${text.slice(insertAt)}`;
}

function verifyEdit({
  edited,
  path,
  value,
}: {
  edited: string;
  path: string[];
  value: string;
}): Result<string> {
  const reparsed = parseManifestText(edited);
  if (!reparsed.ok) {
    return {
      ok: false,
      error: `edit produced invalid JSON: ${reparsed.error}`,
    };
  }
  let cursor: unknown = reparsed.value;
  for (const key of path) {
    cursor = isRecord(cursor) ? cursor[key] : undefined;
  }
  if (cursor !== value) {
    return { ok: false, error: `edit did not set \`${path.join(".")}\`` };
  }
  return { ok: true, value: edited };
}

// A minimal JSONC scanner that records where each value sits in the
// source text. It only runs on text that already parsed, so a
// malformed token here is a bug in the scanner, not user input.
interface Span {
  start: number;
  end: number;
}
interface JsoncMember {
  key: string;
  keySpan: Span;
  value: JsoncNode;
}
interface JsoncObject {
  kind: "object";
  span: Span;
  members: JsoncMember[];
}
type JsoncNode =
  | JsoncObject
  | { kind: "array"; span: Span }
  | { kind: "string"; span: Span }
  | { kind: "literal"; span: Span };
// {}

function scanJsonc(text: string): JsoncNode {
  let position = 0;

  const skipTrivia = (): void => {
    while (position < text.length) {
      const char = text.charAt(position);
      if (/\s/.test(char)) {
        position += 1;
      } else if (text.startsWith("//", position)) {
        const lineEnd = text.indexOf("\n", position);
        position = lineEnd === -1 ? text.length : lineEnd;
      } else if (text.startsWith("/*", position)) {
        const commentEnd = text.indexOf("*/", position + 2);
        position = commentEnd === -1 ? text.length : commentEnd + 2;
      } else {
        return;
      }
    }
  };

  const scanString = (): Span => {
    const start = position;
    position += 1; // opening quote
    while (text.charAt(position) !== '"') {
      if (position >= text.length) throw new Error("unterminated string");
      position += text.charAt(position) === "\\" ? 2 : 1;
    }
    position += 1; // closing quote
    return { start, end: position };
  };

  const scanValue = (): JsoncNode => {
    skipTrivia();
    const start = position;
    const char = text.charAt(position);
    if (char === '"') return { kind: "string", span: scanString() };
    if (char === "{" || char === "[") {
      const closing = char === "{" ? "}" : "]";
      const members: JsoncMember[] = [];
      position += 1;
      skipTrivia();
      while (text.charAt(position) !== closing) {
        if (char === "{") {
          const keySpan = scanString();
          const key: unknown = JSON.parse(
            text.slice(keySpan.start, keySpan.end),
          );
          if (typeof key !== "string") throw new Error("non-string key");
          skipTrivia();
          position += 1; // colon
          members.push({ key, keySpan, value: scanValue() });
        } else {
          scanValue();
        }
        skipTrivia();
        if (text.charAt(position) === ",") position += 1;
        skipTrivia();
        if (position >= text.length) throw new Error(`unclosed ${char}`);
      }
      position += 1;
      const span = { start, end: position };
      if (char === "{") return { kind: "object", span, members };
      return { kind: "array", span };
    }
    while (position < text.length && /[^\s,\]}/]/.test(text.charAt(position))) {
      position += 1;
    }
    if (position === start) throw new Error(`unexpected '${char}'`);
    return { kind: "literal", span: { start, end: position } };
  };

  return scanValue();
}

if (import.meta.main) {
  await main();
}
