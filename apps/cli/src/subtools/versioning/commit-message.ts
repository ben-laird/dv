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
//
// When --prune was honored, the dropped unresolved references appear
// in both summary ("prune 1 unresolved") and details ("- pruned
// unresolved reference 'name' (record.md)") so the commit message
// reflects the actual change being made — without it a 100%-prune
// run produces `chore(release): \n\n`, which is both a bug
// (audit finding 3) and useless in `git log`.

const DEFAULT_COMMIT_MESSAGE_TEMPLATE =
  "chore(release): {summary}\n\n{details}";

export interface RenderCommitMessageArgs {
  plan: Plan;
  template?: string;
  // True when --prune was passed AND there were unresolved references
  // to drop. False otherwise (including when --prune was passed but
  // nothing was actually unresolved). The caller knows which case
  // applies; the renderer just consumes the flag.
  prunedUnresolved?: boolean;
}

export function renderCommitMessage(args: RenderCommitMessageArgs): string {
  const template = args.template ?? DEFAULT_COMMIT_MESSAGE_TEMPLATE;
  const summary = renderSummary(args);
  const details = renderDetails(args);
  return template
    .replaceAll("{summary}", summary)
    .replaceAll("{details}", details);
}

function renderSummary(args: RenderCommitMessageArgs): string {
  const segments = args.plan.pending.map(
    (entry) => `${entry.package} ${entry.projectedVersion}`,
  );
  if (args.prunedUnresolved && args.plan.unresolvedReferences.length > 0) {
    const count = args.plan.unresolvedReferences.length;
    segments.push(`prune ${count} unresolved`);
  }
  return segments.join(", ");
}

function renderDetails(args: RenderCommitMessageArgs): string {
  const lines = args.plan.pending.map((entry) => {
    const changeSummary = formatChangeCounts(entry.changeCounts);
    const changeSuffix = changeSummary.length > 0 ? ` (${changeSummary})` : "";
    return `- ${entry.package} ${entry.currentVersion} → ${entry.projectedVersion}${changeSuffix}`;
  });
  if (args.prunedUnresolved) {
    for (const unresolved of args.plan.unresolvedReferences) {
      lines.push(
        `- pruned unresolved reference '${unresolved.reference}' (${unresolved.record})`,
      );
    }
  }
  return lines.join("\n");
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
