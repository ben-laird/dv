#!/usr/bin/env -S deno run --allow-env --allow-net
// Applies GitHub Flow protection to the default branch via a repository
// RULESET (not the older classic branch-protection API).
//
// In our model main is the only long-lived branch and doubles as the
// nightly + release branch, so the rules here are what make the flow
// mandatory rather than merely conventional: every change lands through a
// reviewed PR that passed `validate`, history stays linear, and nobody
// force-pushes or deletes main.
//
// The one carve-out: the release bot pushes the version-bump commit
// straight to main (see .github/workflows/dv-release.yml), so the repo
// admin role is given a bypass — otherwise the ruleset rejects its push.
// DV_PAT (a repo-admin PAT) authenticates that push, so the admin-role
// bypass covers it without hardcoding an account.
//
// Idempotent: finds the ruleset by name and updates it in place if it
// already exists (creates it otherwise), so re-running converges rather
// than duplicating. Guarded behind --confirm.
//
// Usage:
//   GITHUB_TOKEN=<repo-admin-token> \
//     deno run --allow-env --allow-net \
//     .github/scripts/setup-branch-protection.ts --confirm \
//     [--repo owner/name] [--name "Protect Main"] [--reviews N] \
//     [--check validate]

import { parseArgs } from "jsr:@std/cli@^1/parse-args";
import { Octokit, type RestEndpointMethodTypes } from "npm:@octokit/rest@^21";

// The full create-ruleset parameters (including owner/repo). Typing the
// payload against octokit's own parameters narrows every nested literal
// (rule `type`s, bypass `actor_type`) so a typo fails the type-check. We
// build the whole object as one typed literal rather than spreading a
// partial body into the call — TS can't prove a spread satisfies the
// required `name`/`enforcement` fields, but a direct literal it can.
type CreateRulesetParams =
  RestEndpointMethodTypes["repos"]["createRepoRuleset"]["parameters"];

const DEFAULT_RULESET_NAME = "Protect Main";
const DEFAULT_REVIEWS = 0;
const DEFAULT_CHECK = "validate";

// GitHub's built-in role IDs for ruleset bypass actors. 5 = repository
// admin. Tying the bypass to the admin *role* (not a specific account)
// keeps it stable if DV_PAT is reissued or handed to another maintainer.
const REPO_ADMIN_ROLE_ID = 5;

async function main(): Promise<void> {
  const flags = parseArgs(Deno.args, {
    boolean: ["confirm"],
    string: ["repo", "name", "reviews", "check"],
    default: { name: DEFAULT_RULESET_NAME, check: DEFAULT_CHECK },
  });

  if (!flags.confirm) {
    console.error(
      "Refusing to run without --confirm. This mutates the branch ruleset " +
        "on the live repo.\nRe-run with --confirm once you've reviewed the flags.",
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
  const rulesetName = flags.name;
  const requiredCheck = flags.check;

  const octokit = new Octokit({ auth: githubToken });

  // The ruleset payload. Targets the default branch; enforces the
  // GitHub Flow rules; bypasses the repo-admin role for the release bot.
  const rulesetBody: CreateRulesetParams = {
    owner,
    repo,
    name: rulesetName,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    bypass_actors: [
      {
        actor_id: REPO_ADMIN_ROLE_ID,
        actor_type: "RepositoryRole",
        bypass_mode: "always",
      },
    ],
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" }, // no force-push
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: requiredReviews,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          // GitHub Flow → linear history. Squash/rebase only, no merge
          // commits.
          allowed_merge_methods: ["squash", "rebase"],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true, // up to date before merge
          do_not_enforce_on_create: false,
          required_status_checks: [{ context: requiredCheck }],
        },
      },
    ],
  };

  console.log(
    `Applying GitHub Flow ruleset "${rulesetName}" to ${owner}/${repo} ` +
      `(default branch):\n` +
      `  - required check: ${requiredCheck} (strict)\n` +
      `  - required approving reviews: ${requiredReviews}\n` +
      `  - linear history (squash/rebase only), no force-push, no deletion\n` +
      `  - bypass: repository admin role (covers the DV_PAT release push)`,
  );

  const existing = await findRulesetByName({
    octokit,
    owner,
    repo,
    rulesetName,
  });

  if (existing === null) {
    await octokit.repos.createRepoRuleset(rulesetBody);
    console.log(`Created ruleset "${rulesetName}".`);
  } else {
    await octokit.repos.updateRepoRuleset({
      ...rulesetBody,
      ruleset_id: existing.id,
    });
    console.log(
      `Updated existing ruleset "${rulesetName}" (id ${existing.id}).`,
    );
  }
}

/** Finds a branch ruleset by name, or null. */
async function findRulesetByName(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  rulesetName: string;
}): Promise<{ id: number } | null> {
  const { octokit, owner, repo, rulesetName } = args;
  const response = await octokit.repos.getRepoRulesets({ owner, repo });
  const match = response.data.find((ruleset) => ruleset.name === rulesetName);
  return match ? { id: match.id } : null;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}
