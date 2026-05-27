// Example dv plugin for npm workspaces. Single-file dispatcher
// wired in via the `run:` plugin reference arm:
//
//   discovery:
//     plugins:
//       - match: ["packages/*", "apps/*"]
//         use:
//           run: deno run -A ./examples/plugins/npm/main.ts
//
// Switches on Deno.args[0] to route to the per-Op handler. JSON-
// over-stdio per specs/plugin-contract.md. Copy this whole file
// into your own repo, adapt as needed — it is not a maintained
// dependency (`examples/CLAUDE.md`).
//
// Why a Deno script for an npm ecosystem: the contract is JSON-
// over-stdio, language-agnostic. Using Deno here mirrors the deno
// example for symmetry and zero install footprint, but a real npm
// shop could rewrite this as a Node script (or even bash + jq) and
// dv wouldn't notice the difference. The contract is what matters;
// the implementation language is the author's call.
//
// Targets package.json: reads `name` for discovery, `version` for
// read/write-version, walks every `*dependencies` map for the
// cascade, and runs `npm install --package-lock-only` in finalize
// so package-lock.json refreshes in the same commit as the manifest
// edits.

import { expandGlob } from "jsr:@std/fs@^1/expand-glob";
import { dirname, join, relative } from "jsr:@std/path@^1";

// Every npm manifest field where a dependency constraint might
// appear. The cascade walks all four; npm's runtime resolution
// rules don't distinguish them for the rewrite step (a version is
// a version). Bundled and overrides are intentionally skipped —
// they have different semantics (bundledDependencies is a name
// list with no constraints; overrides has its own DSL).
//
// Declared at module scope (above the top-level switch) so the
// op handlers — which run *during* top-level execution via
// `await runX()` — can read it without tripping the temporal
// dead zone.
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

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
    runRelease();
    break;
  case "finalize":
    await runFinalize();
    break;
  default:
    console.error(`unknown dv op: '${op ?? "<missing>"}'`);
    Deno.exit(1);
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
      name: "npm",
      version: "0.1.0",
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
  const packageJsonGlob = `${glob.replace(/\/$/, "")}/package.json`;
  const packages: { name: string; path: string }[] = [];
  for await (const entry of expandGlob(packageJsonGlob, {
    root: repoRoot,
    includeDirs: false,
  })) {
    let parsed: { name?: string };
    try {
      parsed = JSON.parse(await Deno.readTextFile(entry.path));
    } catch {
      continue;
    }
    if (typeof parsed.name !== "string" || parsed.name.length === 0) continue;
    // `"private": true` packages are tracked the same as any
    // other — dv runs the cascade through them so internal
    // version references stay coherent. The release op is the
    // right place to check `private` and skip publishing (a real
    // implementation would read package.json again there).
    packages.push({
      name: parsed.name,
      path: relative(repoRoot, dirname(entry.path)),
    });
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
  const manifestPath = join(packagePath, "package.json");
  let parsed: { version?: unknown };
  try {
    parsed = JSON.parse(await Deno.readTextFile(manifestPath));
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({
        ok: false,
        error: `cannot read package.json: ${reason}`,
      }),
    );
    Deno.exit(1);
  }
  // Manifests without a `version` field report 0.0.0 — the
  // documented "no version yet" default. dv's algebra treats
  // 0.0.0 as Unstable.
  const reportedVersion =
    typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : "0.0.0";
  console.log(JSON.stringify({ version: reportedVersion }));
}

// === write-version =============================================

async function runWriteVersion(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  const newVersion = Deno.env.get("DV_NEW_VERSION");
  if (!packagePath || !newVersion) {
    console.error("DV_PACKAGE_PATH and DV_NEW_VERSION are required");
    Deno.exit(1);
  }
  const manifestPath = join(packagePath, "package.json");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await Deno.readTextFile(manifestPath));
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({
        ok: false,
        error: `cannot read package.json: ${reason}`,
      }),
    );
    Deno.exit(1);
  }
  // Set/replace the `version` field. Preserves other fields and
  // their insertion order; formatting is JSON.stringify's standard
  // 2-space indent + trailing newline, which matches the npm
  // convention and what `npm version` itself produces. Hand-edited
  // package.json files sometimes use other indentations; this
  // plugin normalizes — adapt if your repo enforces a custom format.
  parsed.version = newVersion;
  await Deno.writeTextFile(
    manifestPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: true }));
}

// === update-dependency =========================================

async function runUpdateDependency(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  if (!packagePath) {
    console.error("DV_PACKAGE_PATH is required");
    Deno.exit(1);
  }
  // update-dependency is the one op that receives a stdin payload
  // (the dependency name + new version). The plugin runner sets
  // stdin to "null" for ops without a payload, so reading stdin
  // here would return EOF immediately — we only read it on the
  // op that actually expects content.
  const stdinText = await new Response(Deno.stdin.readable).text();
  let payload: {
    package?: unknown;
    package_path?: unknown;
    dependency?: unknown;
    new_version?: unknown;
  };
  try {
    payload = JSON.parse(stdinText);
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({ ok: false, error: `stdin not valid JSON: ${reason}` }),
    );
    Deno.exit(1);
  }
  const dependencyName =
    typeof payload.dependency === "string" ? payload.dependency : "";
  const newVersion =
    typeof payload.new_version === "string" ? payload.new_version : "";
  if (!dependencyName || !newVersion) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "stdin payload missing `dependency` or `new_version`",
      }),
    );
    Deno.exit(1);
  }
  const manifestPath = join(packagePath, "package.json");
  let parsed: Record<string, Record<string, string> | unknown>;
  try {
    parsed = JSON.parse(await Deno.readTextFile(manifestPath));
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({
        ok: false,
        error: `cannot read package.json: ${reason}`,
      }),
    );
    Deno.exit(1);
  }

  // Walk each dependency field; rewrite anywhere the dep appears.
  // A package can legitimately list the same dep in multiple
  // fields (e.g. dependencies + peerDependencies) — we update all
  // of them so the manifest stays internally consistent.
  let rewroteAny = false;
  for (const fieldName of DEPENDENCY_FIELDS) {
    const fieldValue = parsed[fieldName];
    if (fieldValue === null || typeof fieldValue !== "object") continue;
    const dependencyMap = fieldValue as Record<string, string>;
    const originalConstraint = dependencyMap[dependencyName];
    if (typeof originalConstraint !== "string") continue;
    const rewrittenConstraint = rewriteConstraintVersion(
      originalConstraint,
      newVersion,
    );
    if (rewrittenConstraint === originalConstraint) continue;
    dependencyMap[dependencyName] = rewrittenConstraint;
    rewroteAny = true;
  }
  if (!rewroteAny) {
    // No-op path of the cascade: this dependent doesn't list the
    // bumped package (or already has it pinned to the new version,
    // somehow). dv's plan-builder reports the cross product; the
    // plugin filters here.
    console.log(JSON.stringify({ ok: true, changed: false }));
    return;
  }
  await Deno.writeTextFile(
    manifestPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: true, changed: true }));
}

// Preserves the original range prefix (`^`, `~`, `>=`, exact pin,
// etc.) and rewrites the version. Returns the original unchanged
// on total parse failure — the cascade reports changed:false rather
// than failing the run, so the user can hand-fix odd constraints
// (workspace:*, file:..., git+https://..., http URLs, npm: aliases)
// without the plugin guessing wrong.
function rewriteConstraintVersion(
  originalConstraint: string,
  nextVersion: string,
): string {
  // Bail on non-semver constraint forms outright — these need a
  // human decision, not a regex rewrite.
  if (
    originalConstraint.startsWith("workspace:") ||
    originalConstraint.startsWith("file:") ||
    originalConstraint.startsWith("link:") ||
    originalConstraint.startsWith("git+") ||
    originalConstraint.startsWith("git:") ||
    originalConstraint.startsWith("http:") ||
    originalConstraint.startsWith("https:") ||
    originalConstraint.startsWith("npm:") ||
    originalConstraint === "*" ||
    originalConstraint === "latest"
  ) {
    return originalConstraint;
  }
  const matchedPattern = originalConstraint.match(
    /^([\^~]|>=?|<=?|=)?\s*([\dA-Za-z.\-+]+)$/,
  );
  if (matchedPattern === null) return originalConstraint;
  const rangePrefix = matchedPattern[1] ?? "";
  // Preserve `^` / `~` / comparator prefixes. Exact-pin
  // constraints (no prefix) widen to caret — the modern npm
  // convention for dv-bumped versions; exact pins are rare and
  // usually accidental in dependency declarations.
  const preservedPrefix =
    rangePrefix === "" || rangePrefix === "=" ? "^" : rangePrefix;
  return `${preservedPrefix}${nextVersion}`;
}

// === get-dependencies ==========================================

// Reports which OTHER discovered packages this one depends on, so
// `dv release` can publish dependencies before their dependents
// (npm registry doesn't reject unpublished imports the way JSR
// does — but the topological order is still cleaner because
// `npm install` resolves transitive deps against the registry at
// install time, so consumers can install your fresh release
// immediately after publish).
//
// Implementation: walk every `*Dependencies` field in package.json
// (the same set the cascade walks) and pull out any keys that
// appear in the candidate list. Matching is by package name
// alone; we don't parse constraint syntax.

async function runGetDependencies(): Promise<void> {
  const packagePath = Deno.env.get("DV_PACKAGE_PATH");
  if (!packagePath) {
    console.error("DV_PACKAGE_PATH is required");
    Deno.exit(1);
  }
  // get-dependencies reads `candidates` from stdin so the plugin
  // can scope its match without re-running discovery. dv passes
  // every OTHER discovered package's name; we return the subset
  // present in this package's manifest.
  const stdinText = await new Response(Deno.stdin.readable).text();
  let payload: { candidates?: unknown };
  try {
    payload = JSON.parse(stdinText);
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({ ok: false, error: `stdin not valid JSON: ${reason}` }),
    );
    Deno.exit(1);
  }
  if (!Array.isArray(payload.candidates)) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "stdin payload missing `candidates` array",
      }),
    );
    Deno.exit(1);
  }
  const candidateSet = new Set<string>(
    payload.candidates.filter(
      (candidate): candidate is string => typeof candidate === "string",
    ),
  );

  const manifestPath = join(packagePath, "package.json");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await Deno.readTextFile(manifestPath));
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({
        ok: false,
        error: `cannot read package.json: ${reason}`,
      }),
    );
    Deno.exit(1);
  }

  // Walk every dependency-bearing field. A package may list the
  // same dep under multiple fields (dependencies + peer, say) —
  // emit it once.
  const foundDependencies = new Set<string>();
  for (const fieldName of DEPENDENCY_FIELDS) {
    const fieldValue = parsed[fieldName];
    if (fieldValue === null || typeof fieldValue !== "object") continue;
    const dependencyMap = fieldValue as Record<string, string>;
    for (const dependencyName of Object.keys(dependencyMap)) {
      if (candidateSet.has(dependencyName)) {
        foundDependencies.add(dependencyName);
      }
    }
  }
  const dependencies = [...foundDependencies].sort();
  console.log(JSON.stringify({ ok: true, dependencies }));
}

// === release ===================================================

function runRelease(): void {
  // STUB: reports a successful no-publish result so `dv release`
  // can complete the tag-minting + plugin-dispatch path end-to-end
  // without actually pushing anything to npm. A real plugin for an
  // npm workspace would `npm publish` here (probably gated on the
  // `private` field — see runDiscover).
  //
  // Env vars dv sets for this op:
  //   DV_REPO_ROOT    — absolute path to repo root
  //   DV_PACKAGE_NAME — package name from discover
  //   DV_PACKAGE_PATH — directory of this package, relative to repo
  //   DV_NEW_VERSION  — the version just tagged
  //   DV_GIT_TAG      — the tag string that was minted
  //
  // Return shape (specs/schemas/plugin-responses.json):
  //   { ok, published?, skipped?, message? }
  //
  // A real implementation might look something like:
  //
  //   const packagePath = Deno.env.get("DV_PACKAGE_PATH")!;
  //   const result = await new Deno.Command("npm", {
  //     args: ["publish", "--access", "public"],
  //     cwd: packagePath,
  //     stdout: "piped",
  //     stderr: "piped",
  //   }).output();
  //   if (!result.success) {
  //     const stderrText = new TextDecoder().decode(result.stderr).trim();
  //     console.log(JSON.stringify({
  //       ok: false,
  //       message: `npm publish failed: ${stderrText}`,
  //     }));
  //     return;
  //   }
  //   console.log(JSON.stringify({ ok: true, published: true }));
  //
  // Per specs/plugin-contract.md, a release-op failure does NOT
  // roll back the tag — the plugin's job is to be idempotent (or
  // at least safe to re-run via `dv release --force`). Returning
  // `{ ok: false, message: "..." }` is a valid response shape: dv
  // continues with the rest of the run and surfaces the failure
  // in the summary.
  const packageName = Deno.env.get("DV_PACKAGE_NAME") ?? "<unknown>";
  const newVersion = Deno.env.get("DV_NEW_VERSION") ?? "<unknown>";
  console.log(
    JSON.stringify({
      ok: true,
      published: false,
      message: `example plugin: would have run \`npm publish\` for ${packageName}@${newVersion}; replace this stub to actually publish`,
    }),
  );
}

// === finalize ==================================================

// Fires once per plugin after every write-version + cascade
// update-dependency call has completed, before dv stages + commits.
// We refresh package-lock.json (the one at the repo root in
// npm-workspace setups; per-package if not) so it ships with the
// manifest edits in the same commit.
//
// Env vars dv sets for this op:
//   DV_REPO_ROOT            — absolute path to repo root
//   DV_FINALIZE_TRIGGER     — "version" or "v1"
//   DV_BUMPED_PACKAGES      — JSON array of {name, path, new_version}
//                             entries for packages this plugin
//                             governs that bumped this run
//
// Return shape (specs/schemas/plugin-responses.json):
//   { ok, unsupported?, additionalChangedFiles?, message? }

interface FinalizeBumpedPackageEntry {
  name: string;
  path: string;
  new_version: string;
}

async function runFinalize(): Promise<void> {
  const repoRoot = Deno.env.get("DV_REPO_ROOT");
  const bumpedPackagesJson = Deno.env.get("DV_BUMPED_PACKAGES");
  if (!repoRoot) {
    console.log(
      JSON.stringify({ ok: false, error: "DV_REPO_ROOT is required" }),
    );
    Deno.exit(1);
  }

  // Where the lockfile lives depends on whether this is a workspace
  // (root-level package-lock.json) or a non-workspace set of
  // packages (per-package lockfiles). We discover that by looking
  // at the root package.json: if it declares `workspaces`, refresh
  // the root lockfile once; otherwise refresh each bumped package's
  // own lockfile.
  const isWorkspace = await detectNpmWorkspaceRoot({ repoRoot });
  const targetDirectories = isWorkspace
    ? [repoRoot]
    : await collectBumpedPackageDirectories({
        repoRoot,
        bumpedPackagesJson: bumpedPackagesJson ?? "[]",
      });

  const additionalChangedFiles: string[] = [];
  for (const targetDirectory of targetDirectories) {
    const lockfilePath = join(targetDirectory, "package-lock.json");
    const lockfileBefore = await readFileOrUndefined(lockfilePath);

    // `npm install --package-lock-only` updates the lockfile from
    // the current manifests *without* downloading or installing
    // anything to node_modules. This is the standard npm idiom for
    // "refresh the lockfile to match the manifest." Quiet so its
    // output doesn't leak into our stdout (which dv parses as JSON).
    const installResult = await new Deno.Command("npm", {
      args: ["install", "--package-lock-only", "--silent"],
      cwd: targetDirectory,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!installResult.success) {
      const stderrText = new TextDecoder().decode(installResult.stderr).trim();
      console.log(
        JSON.stringify({
          ok: false,
          error: `npm install --package-lock-only failed in ${relative(repoRoot, targetDirectory) || "."} (exit ${installResult.code}): ${stderrText || "<no stderr>"}`,
        }),
      );
      Deno.exit(1);
    }

    const lockfileAfter = await readFileOrUndefined(lockfilePath);
    if (lockfileBefore !== lockfileAfter) {
      // Report repo-relative path so it lines up with the other
      // paths dv stages.
      additionalChangedFiles.push(
        relative(repoRoot, lockfilePath) || "package-lock.json",
      );
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      additionalChangedFiles,
      message:
        additionalChangedFiles.length > 0
          ? `refreshed ${additionalChangedFiles.length} lockfile${additionalChangedFiles.length === 1 ? "" : "s"}`
          : "package-lock.json already up to date",
    }),
  );
}

interface DetectNpmWorkspaceRootArgs {
  repoRoot: string;
}

async function detectNpmWorkspaceRoot(
  args: DetectNpmWorkspaceRootArgs,
): Promise<boolean> {
  const rootManifestPath = join(args.repoRoot, "package.json");
  let parsed: { workspaces?: unknown };
  try {
    parsed = JSON.parse(await Deno.readTextFile(rootManifestPath));
  } catch {
    return false;
  }
  // npm accepts two `workspaces` shapes: a plain array of globs,
  // or an object `{packages: [...]}`. Either presence flags this
  // repo as a workspace, which means there's a single lockfile at
  // the root that covers every member.
  if (Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
    return true;
  }
  if (
    parsed.workspaces !== null &&
    typeof parsed.workspaces === "object" &&
    Array.isArray((parsed.workspaces as { packages?: unknown }).packages)
  ) {
    return true;
  }
  return false;
}

interface CollectBumpedPackageDirectoriesArgs {
  repoRoot: string;
  bumpedPackagesJson: string;
}

async function collectBumpedPackageDirectories(
  args: CollectBumpedPackageDirectoriesArgs,
): Promise<string[]> {
  let bumpedEntries: FinalizeBumpedPackageEntry[];
  try {
    const parsed = JSON.parse(args.bumpedPackagesJson);
    bumpedEntries = Array.isArray(parsed) ? parsed : [];
  } catch {
    bumpedEntries = [];
  }
  const absoluteDirectories: string[] = [];
  for (const entry of bumpedEntries) {
    if (typeof entry?.path !== "string") continue;
    const absoluteDirectory = join(args.repoRoot, entry.path);
    // Skip packages without a package.json — they can't have a
    // lockfile to refresh.
    const manifestPath = join(absoluteDirectory, "package.json");
    try {
      await Deno.stat(manifestPath);
    } catch {
      continue;
    }
    absoluteDirectories.push(absoluteDirectory);
  }
  return absoluteDirectories;
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return undefined;
    throw caughtError;
  }
}
