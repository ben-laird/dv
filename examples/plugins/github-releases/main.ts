// Example dv plugin: publish to GitHub Releases via `gh release create`.
//
// Unlike the deno/ and npm/ example plugins, this is a **release-only
// plugin**: it doesn't read or write manifests, doesn't participate in
// the cascade, and doesn't refresh lockfiles. Its job is one thing —
// when `dv release` mints a tag, create the matching GitHub Release
// with a generated changelog body.
//
// ## Wiring it in
//
// dv's v1 model is one plugin per package: the package's plugin owns
// every op including `release`. **This means you can't wire this
// plugin in as a SECOND release channel alongside the deno or npm
// plugin** — the discovery layer would error with
// `package-conflict` (two plugins claiming the same path).
//
// Multi-channel publishing — having dv invoke BOTH the deno plugin's
// `release` (publish to JSR) AND this plugin's `release` (post a
// GitHub Release) for the same package — is a v2 contract design.
// See ROADMAP.md § "Opt into multi-channel publishing".
//
// For now, this example exists to:
//
//   1. Demonstrate the **shape** of a release-only plugin — what's
//      in `info.supportedOps`, what `discover` returns when the
//      plugin doesn't own discovery, how `release` shells out.
//   2. Be **runnable** via `dv plugin invoke` and `dv plugin verify`
//      so the implementation is real, not pseudocode.
//   3. Give v2 multi-channel work a working precedent to point at.
//
// ## Quick verification
//
//   $ dv plugin verify "run:deno run -A ./examples/plugins/github-releases/main.ts"
//
// You can also exercise `release` directly against a real package
// (this DOES create a real GitHub Release — use a throwaway repo):
//
//   $ dv plugin invoke "run:deno run -A ./examples/plugins/github-releases/main.ts" \
//       release --package "@my/api" --path apps/api \
//       --new-version "1.0.0" --git-tag "@my/api@1.0.0" \
//       --repo-root "$(pwd)"
//
// ## Requirements
//
// - `gh` CLI installed and authenticated (`gh auth status` shows logged in).
// - The git tag must already exist locally and on the remote — `gh
//   release create` requires a real tag. dv mints the tag and pushes
//   it (when --push) before invoking this op, so the precondition
//   holds in normal `dv release` runs.

const op = Deno.args[0];
switch (op) {
  case "info":
    runInfo();
    break;
  case "discover":
    runDiscover();
    break;
  case "read-version":
    runReadVersion();
    break;
  case "release":
    await runRelease();
    break;
  default:
    console.error(`unknown dv op: '${op ?? "<missing>"}'`);
    Deno.exit(1);
}

// === info ======================================================

// Declares the minimal op set for a release-only plugin. `info` and
// `discover` are mandatory by the contract; `read-version` is needed
// because dv's release pipeline calls read-version for every
// discovered package to build the awaiting-release set, even when
// the plugin's release op doesn't itself need a version. We omit
// `write-version`, `update-dependency`, `finalize`, and
// `get-dependencies` — they're optional, and a release-only plugin
// has no business with them.
function runInfo(): void {
  console.log(
    JSON.stringify({
      contractVersion: "1",
      supportedOps: ["info", "discover", "read-version", "release"],
      name: "github-releases",
      version: "0.1.0",
    }),
  );
}

// === discover ==================================================

// A release-only plugin can't *also* own the manifest layer — but
// `discover` is mandatory, so it has to return something. Two
// realistic shapes:
//
//   1. **Empty array** — claim no packages. This means dv won't
//      invoke any other op (including `release`) on this plugin
//      during a real run; the plugin can still be exercised via
//      `dv plugin invoke` for testing.
//
//   2. **Match a non-overlapping glob** — e.g. the user wires this
//      plugin in with `match: ["my-app"]` and ANOTHER plugin
//      governs every other package. dv's release pipeline calls
//      `release` on each package's discovered plugin, so the
//      "my-app" package would publish to GitHub Releases only.
//
// We go with option 1 here because option 2 is only useful when
// the user actively scopes the glob. The empty default keeps this
// example *runnable* (via `dv plugin invoke`) without accidentally
// participating in a real release.
//
// When v2 multi-channel publishing lands, the contract will likely
// grow a way for a plugin to register as a release CHANNEL without
// claiming packages — at which point this op shape becomes
// vestigial. See ROADMAP.md.
function runDiscover(): void {
  // Read DV_DISCOVER_GLOB so the env-var validation pre-check
  // matches what other plugins do; the value itself doesn't change
  // the empty response.
  const _glob = Deno.env.get("DV_DISCOVER_GLOB");
  console.log(JSON.stringify({ packages: [] }));
}

// === read-version ==============================================

// Release-only plugins don't have a manifest to read from. We
// report 0.0.0 — dv's algebra treats this as Unstable, and since
// this plugin's discover returns no packages in normal runs the
// version is never actually consulted. We implement read-version
// only because dv's pipeline expects every supported op to work
// when `dv plugin invoke` calls it.
//
// If you adapt this plugin to claim real packages (the
// non-overlapping-glob pattern described in discover), you'd want
// to either (a) defer to the other plugin somehow, or (b) read
// from a sidecar file. v1 has no clean answer; v2's multi-channel
// design will.
function runReadVersion(): void {
  console.log(JSON.stringify({ version: "0.0.0" }));
}

// === release ===================================================

// The actual work. dv invokes this once per package being released
// (per the dv release work-list), AFTER the tag has been minted and
// (when --push) pushed to origin. Env vars:
//
//   DV_REPO_ROOT    — absolute path to repo root
//   DV_PACKAGE_NAME — the package being released
//   DV_PACKAGE_PATH — repo-relative path to the package directory
//   DV_NEW_VERSION  — the version (matches the tag's version part)
//   DV_GIT_TAG      — the tag name dv minted (e.g. "@my/api@1.2.3")
//
// We shell out to `gh release create <tag> --generate-notes`,
// which auto-generates a changelog body from commits since the
// previous tag. The plugin owns the convention of using
// `--generate-notes`; users who want hand-curated bodies should
// adapt this script to read from CHANGELOG.md or pass --notes-file.

async function runRelease(): Promise<void> {
  const repoRoot = Deno.env.get("DV_REPO_ROOT");
  const packageName = Deno.env.get("DV_PACKAGE_NAME") ?? "<unknown>";
  const newVersion = Deno.env.get("DV_NEW_VERSION") ?? "<unknown>";
  const gitTag = Deno.env.get("DV_GIT_TAG");
  if (!repoRoot || !gitTag) {
    console.log(
      JSON.stringify({
        ok: false,
        message: "DV_REPO_ROOT and DV_GIT_TAG are required",
      }),
    );
    return;
  }

  // `gh release create <tag>` requires the tag to exist on the
  // remote (or it'll create one from --target). dv pushes tags
  // before invoking release (when --push), so the precondition
  // holds in a normal run. The --generate-notes flag has GitHub
  // auto-build a changelog body from PR titles between tags.
  //
  // --title defaults to the tag name; we override to include the
  // package name so a monorepo's release list reads cleanly
  // ("@my/api 1.2.3" vs "@my/api@1.2.3").
  const releaseTitle = `${packageName} ${newVersion}`;
  const createResult = await new Deno.Command("gh", {
    args: [
      "release",
      "create",
      gitTag,
      "--title",
      releaseTitle,
      "--generate-notes",
    ],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!createResult.success) {
    const stderrText = new TextDecoder().decode(createResult.stderr).trim();
    // Per specs/plugin-contract.md, `release` is the one op where
    // `{ok: false, message: "..."}` is a valid response — dv records
    // the failure into the per-package outcome list and continues
    // with the rest of the work. Tags are NOT rolled back.
    console.log(
      JSON.stringify({
        ok: false,
        message: `gh release create failed for ${gitTag} (exit ${createResult.code}): ${stderrText || "<no stderr>"}`,
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      ok: true,
      published: true,
      message: `created GitHub Release for ${gitTag}`,
    }),
  );
}
