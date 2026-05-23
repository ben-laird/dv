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
import { dirname, join, relative } from "jsr:@std/path@^1";

const op = Deno.args[0];
switch (op) {
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
  default:
    console.error(`unknown dv op: '${op ?? "<missing>"}'`);
    Deno.exit(1);
}

// === discover ==================================================

async function runDiscover(): Promise<void> {
  const repoRoot = Deno.env.get("DV_REPO_ROOT");
  const glob = Deno.env.get("DV_DISCOVER_GLOB");
  if (!repoRoot || !glob) {
    console.error("DV_REPO_ROOT and DV_DISCOVER_GLOB are required");
    Deno.exit(1);
  }
  const denoJsonGlob = `${glob.replace(/\/$/, "")}/deno.json`;
  const packages: { name: string; path: string }[] = [];
  for await (const entry of expandGlob(denoJsonGlob, {
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
  const manifestPath = join(packagePath, "deno.json");
  let parsed: { version?: unknown };
  try {
    parsed = JSON.parse(await Deno.readTextFile(manifestPath));
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({ ok: false, error: `cannot read deno.json: ${reason}` }),
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
  const manifestPath = join(packagePath, "deno.json");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await Deno.readTextFile(manifestPath));
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({ ok: false, error: `cannot read deno.json: ${reason}` }),
    );
    Deno.exit(1);
  }
  // Set/replace the `version` field. Preserves other fields and
  // their insertion order; formatting is JSON.stringify's standard
  // 2-space indent + trailing newline (acceptable for v1 — deno.json
  // files in this repo do not carry comments at the root).
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
  const manifestPath = join(packagePath, "deno.json");
  let parsed: { imports?: Record<string, string> };
  try {
    parsed = JSON.parse(await Deno.readTextFile(manifestPath));
  } catch (caughtError) {
    const reason =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    console.log(
      JSON.stringify({ ok: false, error: `cannot read deno.json: ${reason}` }),
    );
    Deno.exit(1);
  }
  const importsMap = parsed.imports;
  const originalSpecifier =
    importsMap !== undefined && typeof importsMap[dependencyName] === "string"
      ? importsMap[dependencyName]
      : undefined;
  if (originalSpecifier === undefined) {
    // No-op path of the cascade: this dependent doesn't import the
    // bumped package. dv's plan-builder reports the cross product;
    // the plugin filters here.
    console.log(JSON.stringify({ ok: true, changed: false }));
    return;
  }
  const rewrittenSpecifier = rewriteSpecifierVersion(
    originalSpecifier,
    newVersion,
  );
  if (rewrittenSpecifier === originalSpecifier) {
    console.log(JSON.stringify({ ok: true, changed: false }));
    return;
  }
  // Type guard: importsMap is defined because originalSpecifier was.
  (importsMap as Record<string, string>)[dependencyName] = rewrittenSpecifier;
  await Deno.writeTextFile(
    manifestPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: true, changed: true }));
}

// Preserves the (jsr:|npm:)?@scope/name prefix and the original
// range prefix (`^`, `~`, exact). Default for unrecognized forms is
// caret — the modern Deno/JS convention. Returning the original
// unchanged on total parse failure is intentional: the cascade
// reports changed:false rather than failing the run, so the user
// can hand-fix odd manifest shapes without the plugin guessing.
function rewriteSpecifierVersion(
  originalSpecifier: string,
  nextVersion: string,
): string {
  const matchedPattern = originalSpecifier.match(
    /^((?:jsr:|npm:)?@?[\w./-]+)@([\^~]?)([\dA-Za-z.\-+]+)$/,
  );
  if (matchedPattern === null) return originalSpecifier;
  const prefixBeforeAt = matchedPattern[1];
  const rangePrefix = matchedPattern[2];
  // Default to caret for unrecognized prefixes (covers the empty-
  // prefix "exact pin" case too — we widen to caret since dv
  // versions are semantically a moving target).
  const preservedPrefix =
    rangePrefix === "^" || rangePrefix === "~" ? rangePrefix : "^";
  return `${prefixBeforeAt}@${preservedPrefix}${nextVersion}`;
}

// === release ===================================================

function runRelease(): void {
  // STUB: reports a successful no-publish result so `dv release`
  // can complete the tag-minting + plugin-dispatch path end-to-end
  // without actually pushing anything to a registry. A real plugin
  // for a Deno workspace would `deno publish` here, or shell out to
  // `npm publish` / `cargo publish` / `gh release create` depending
  // on the ecosystem the package lives in.
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
      message: `example plugin: would have published ${packageName}@${newVersion}; replace this stub to actually publish`,
    }),
  );
}
