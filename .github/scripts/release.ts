#!/usr/bin/env -S deno run --allow-run --allow-read --allow-env --allow-net
// Release orchestration for the one-trunk GitHub Flow model.
//
// main is both our nightly branch and our release branch: every commit
// to main is a nightly, and the git tags this script mints (pkg@x.y.z)
// are the official releases. Invoked by .github/workflows/dv-release.yml
// on every push to main; a no-op when nothing is pending.
//
// Sequence:
//   1. Capture the pending Plan BEFORE `dv version` consumes the Records
//      (so the logged summary reflects the bumps — see ROADMAP wart #1,
//      now resolved by capturing up front rather than after the fact).
//   2. Early-out if nothing is pending: this is a nightly with no release.
//   3. `dv version --yes` — bump manifests, write CHANGELOGs, consume
//      Records, auto-commit on main.
//   4. Push the bump commit back to main (needs DV_PAT + a branch-
//      protection bypass for the bot; see setup-branch-protection.ts).
//   5. `dv release --yes --push` — mint per-package tags and publish.
//   6. Mint one GitHub Release per newly-minted tag, body sliced from the
//      package's freshly-written CHANGELOG.md section.
//
// Written in Deno (not shell) so it is cross-platform and can use the
// official GitHub client. Deps are inline npm:/jsr: specifiers — this is
// CI tooling, deliberately kept out of the CLI's import map.

import { Octokit } from "npm:@octokit/rest@^21";

/**
 * Subset of the `dv release --json` envelope this script consumes.
 *
 * `dv release --json` emits a single shape across no-op, dry-run, and
 * real runs: the wrapped envelope (`{ plan, mintedTagNames, … }`), with
 * empty action arrays on the no-op / dry-run paths. (Earlier versions
 * emitted the bare Plan on those paths; that divergence was fixed.)
 */
interface ReleaseJson {
  plan: {
    awaitingRelease: Array<{
      package: string;
      version: string;
      tag: string;
      releaseNotes: string;
    }>;
  };
  mintedTagNames: string[];
}

/** Subset of the `dv status --json` Plan this script consumes. */
interface StatusJson {
  pending: Array<{
    package: string;
    currentVersion: string;
    projectedVersion: string;
    bump: string;
  }>;
}

interface ReleaseEnvironment {
  /** "owner/repo" from GITHUB_REPOSITORY. */
  owner: string;
  repo: string;
  /** Token with repo write + the protection bypass (DV_PAT in CI). */
  githubToken: string;
}

async function main(): Promise<void> {
  const environment = readEnvironment();
  const forceRequested = Deno.args.includes("--force");

  // 1 + 2: capture the pending Plan up front, before Records are consumed.
  const pendingPlan = await runDvJson<StatusJson>(["status", "--json"]);
  if (pendingPlan.pending.length === 0 && !forceRequested) {
    console.log("No pending Records — nightly with no release. Nothing to do.");
    return;
  }
  logPendingSummary(pendingPlan);

  // 3: compute + commit the bump on main.
  await runDv(["version", "--yes"]);

  // 4: push the bump commit back to main. The bot identity is configured
  // by the workflow; DV_PAT carries it through branch protection.
  await runGit(["push", "origin", "HEAD:main"]);

  // 5: mint tags + publish. --push sends the tags to origin only after
  // publish succeeds (dv's publish-then-push default).
  const releaseArgs = ["release", "--yes", "--push", "--json"];
  if (forceRequested) releaseArgs.push("--force");
  const releaseResult = await runDvJson<ReleaseJson>(releaseArgs);

  // 6: one GitHub Release per newly-minted tag.
  await mintGitHubReleases({ environment, releaseResult });
}

/**
 * Creates a GitHub Release for each tag `dv release` minted this run.
 * Reused tags (already published in a prior run) are skipped — they
 * already have a Release. The body is the package's new CHANGELOG
 * section, which `dv release --json` exposes directly as
 * `awaitingRelease[].releaseNotes` (no CHANGELOG re-parsing here).
 */
async function mintGitHubReleases(args: {
  environment: ReleaseEnvironment;
  releaseResult: ReleaseJson;
}): Promise<void> {
  const { environment, releaseResult } = args;
  const newlyMinted = new Set(releaseResult.mintedTagNames);
  if (newlyMinted.size === 0) {
    console.log("No new tags minted — no GitHub Releases to create.");
    return;
  }

  const awaitingRelease = releaseResult.plan.awaitingRelease;

  const octokit = new Octokit({ auth: environment.githubToken });

  for (const entry of awaitingRelease) {
    if (!newlyMinted.has(entry.tag)) continue;

    const body =
      entry.releaseNotes.length > 0
        ? entry.releaseNotes
        : `Release ${entry.tag}. See the package CHANGELOG.md for details.`;

    await octokit.repos.createRelease({
      owner: environment.owner,
      repo: environment.repo,
      tag_name: entry.tag,
      name: entry.tag,
      body,
    });
    console.log(`Created GitHub Release for ${entry.tag}.`);
  }
}

function logPendingSummary(plan: StatusJson): void {
  console.log(`Found ${plan.pending.length} pending package(s) to release:`);
  for (const entry of plan.pending) {
    console.log(
      `  ${entry.package}: ${entry.currentVersion} -> ${entry.projectedVersion} (${entry.bump})`,
    );
  }
}

function readEnvironment(): ReleaseEnvironment {
  const repository = requireEnv("GITHUB_REPOSITORY"); // "owner/repo"
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(
      `GITHUB_REPOSITORY is malformed: "${repository}" (expected owner/repo).`,
    );
  }
  // DV_PAT preferred (carries the bypass); GITHUB_TOKEN as a fallback.
  const githubToken = Deno.env.get("DV_PAT") ?? requireEnv("GITHUB_TOKEN");
  return { owner, repo, githubToken };
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}

/** Runs `dv <args>` and returns nothing; throws on non-zero exit. */
async function runDv(args: string[]): Promise<void> {
  await run("dv", args);
}

/** Runs `dv <args> --json` and parses stdout as the given shape. */
async function runDvJson<T>(args: string[]): Promise<T> {
  const stdout = await run("dv", args, { captureStdout: true });
  return JSON.parse(stdout) as T;
}

async function runGit(args: string[]): Promise<void> {
  await run("git", args);
}

/**
 * Spawns a subprocess. Streams stderr through; optionally captures
 * stdout (for --json calls). Throws a descriptive error on non-zero exit.
 */
async function run(
  command: string,
  args: string[],
  options: { captureStdout?: boolean } = {},
): Promise<string> {
  console.log(`$ ${command} ${args.join(" ")}`);
  const child = new Deno.Command(command, {
    args,
    stdout: options.captureStdout ? "piped" : "inherit",
    stderr: "inherit",
  });
  const output = await child.output();
  if (!output.success) {
    throw new Error(
      `${command} ${args.join(" ")} exited with code ${output.code}.`,
    );
  }
  return options.captureStdout ? new TextDecoder().decode(output.stdout) : "";
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}
