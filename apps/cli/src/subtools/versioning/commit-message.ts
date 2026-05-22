import type { Plan } from "./plan-schema.ts";

// Renders the `dv version` commit message from the Plan +
// `git.commit-message-template`. The template's variables
// (specs/config-format.md § git) are:
//   {summary} — one-line `name newVersion, name newVersion` list
//   {details} — multi-line bullets: "- name old → new (N feat, M fix)"
//
// The default template is `chore(release): {summary}\n\n{details}`.
// Both substitutions are simple textual replacements; the template is
// trusted (it comes from the user's config).

const DEFAULT_COMMIT_MESSAGE_TEMPLATE =
  "chore(release): {summary}\n\n{details}";

export interface RenderCommitMessageArgs {
  plan: Plan;
  template?: string;
}

export function renderCommitMessage(args: RenderCommitMessageArgs): string {
  const template = args.template ?? DEFAULT_COMMIT_MESSAGE_TEMPLATE;
  const summary = renderSummary(args.plan);
  const details = renderDetails(args.plan);
  return template
    .replaceAll("{summary}", summary)
    .replaceAll("{details}", details);
}

function renderSummary(plan: Plan): string {
  return plan.pending
    .map((entry) => `${entry.package} ${entry.projectedVersion}`)
    .join(", ");
}

function renderDetails(plan: Plan): string {
  return plan.pending
    .map((entry) => {
      const changeSummary = formatChangeCounts(entry.changeCounts);
      const changeSuffix =
        changeSummary.length > 0 ? ` (${changeSummary})` : "";
      return `- ${entry.package} ${entry.currentVersion} → ${entry.projectedVersion}${changeSuffix}`;
    })
    .join("\n");
}

function formatChangeCounts(changeCounts: {
  feat: number;
  fix: number;
  breaking: number;
}): string {
  const segments: string[] = [];
  if (changeCounts.feat > 0) segments.push(`${changeCounts.feat} feat`);
  if (changeCounts.fix > 0) segments.push(`${changeCounts.fix} fix`);
  if (changeCounts.breaking > 0)
    segments.push(`${changeCounts.breaking} breaking`);
  return segments.join(", ");
}
