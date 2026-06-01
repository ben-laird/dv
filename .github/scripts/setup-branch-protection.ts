#!/usr/bin/env -S deno run --allow-env --allow-net
// Applies GitHub Flow branch protection to main.
//
// In our model main is the only long-lived branch and doubles as the
// nightly + release branch, so the rules here are what make the flow
// mandatory rather than merely conventional: every change lands through a
// reviewed PR that passed `validate`, history stays linear, and nobody
// force-pushes or deletes main.
//
// The one carve-out: the release bot pushes the version-bump commit
// straight to main (see .github/workflows/dv-release.yml), so it is added
// to the bypass list — otherwise protection would reject its push.
//
// Idempotent: re-running re-applies the same settings. Guarded behind
// --confirm so it can't mutate the repo by accident.
//
// Usage:
//   GITHUB_TOKEN=<repo-admin-token> \
//     deno run --allow-env --allow-net \
//     .github/scripts/setup-branch-protection.ts --confirm \
//     [--repo owner/name] [--branch main] [--reviews N] [--bot LOGIN]

import { parseArgs } from "jsr:@std/cli@^1/parse-args";
import { Octokit } from "npm:@octokit/rest@^21";

// The required status check. Must match the job name in
// .github/workflows/dv-validate.yml (the `validate` job).
const REQUIRED_CHECK = "validate";
const DEFAULT_BRANCH = "main";
const DEFAULT_REVIEWS = 1;
const DEFAULT_BOT = "dv-release-bot";

async function main(): Promise<void> {
  const flags = parseArgs(Deno.args, {
    boolean: ["confirm"],
    string: ["repo", "branch", "reviews", "bot"],
    default: { branch: DEFAULT_BRANCH, bot: DEFAULT_BOT },
  });

  if (!flags.confirm) {
    console.error(
      "Refusing to run without --confirm. This mutates branch protection on " +
        "the live repo.\nRe-run with --confirm once you've reviewed the flags.",
    );
    Deno.exit(2);
  }

  const repository = flags.repo ?? Deno.env.get("GITHUB_REPOSITORY");
  if (!repository) {
    throw new Error(
      "No repo given. Pass --repo owner/name or set GITHUB_REPOSITORY.",
    );
  }
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`--repo must be "owner/name"; got "${repository}".`);
  }

  const githubToken = Deno.env.get("GITHUB_TOKEN") ?? Deno.env.get("GH_TOKEN");
  if (!githubToken) {
    throw new Error("Set GITHUB_TOKEN (or GH_TOKEN) to a repo-admin token.");
  }

  const requiredReviews = flags.reviews
    ? Number.parseInt(flags.reviews, 10)
    : DEFAULT_REVIEWS;
  const branch = flags.branch;
  const botLogin = flags.bot;

  const octokit = new Octokit({ auth: githubToken });

  console.log(
    `Applying GitHub Flow protection to ${owner}/${repo}@${branch}:\n` +
      `  - required check: ${REQUIRED_CHECK}\n` +
      `  - required approving reviews: ${requiredReviews}\n` +
      `  - linear history, no force-push, no deletion\n` +
      `  - bypass (push to protected main): ${botLogin}`,
  );

  await octokit.repos.updateBranchProtection({
    owner,
    repo,
    branch,
    // Require the validate job to pass on the head before merge.
    required_status_checks: {
      strict: true, // branch must be up to date with main before merge
      contexts: [REQUIRED_CHECK],
    },
    enforce_admins: false, // admins keep their break-glass
    required_pull_request_reviews: {
      required_approving_review_count: requiredReviews,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      // Let the release bot push the bump commit without a review.
      bypass_pull_request_allowances: { users: [botLogin] },
    },
    // GitHub Flow → squash/rebase merges only.
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    // The bot pushes the bump commit straight to main.
    restrictions: { users: [botLogin], teams: [], apps: [] },
  });

  console.log("Branch protection applied.");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}
