import { assertEquals } from "@std/assert";
import { renderCommitMessage } from "./commit-message.ts";
import type { Plan } from "./plan-schema.ts";

// Minimal Plan factory — the renderer only reads `pending` and
// `unresolvedReferences`, so the other fields can be skeletal.
interface BuildPlanArgs {
  pending?: Plan["pending"];
  unresolvedReferences?: Plan["unresolvedReferences"];
}

function buildPlan(args: BuildPlanArgs = {}): Plan {
  return {
    schema: "urn:dv:schema:v1:plan",
    command: "version",
    pending: args.pending ?? [],
    awaitingRelease: [],
    unresolvedReferences: args.unresolvedReferences ?? [],
    tracked: [],
  };
}

Deno.test("renderCommitMessage produces the bumps-only message when there are no pruned unresolved references", () => {
  // Given one pending bump and no unresolved references
  const plan = buildPlan({
    pending: [
      {
        package: "orders",
        currentVersion: "0.3.0",
        projectedVersion: "0.4.0",
        bump: "minor",
        stability: "Unstable",
        changeCounts: { feat: 1, fix: 0, breaking: 0 },
        records: ["multi-currency.md"],
        constraintUpdates: [],
      },
    ],
  });

  // When the commit message is rendered with the default template
  const rendered = renderCommitMessage({ plan });

  // Then the summary line carries the package+version, the details
  // line includes the change counts, and no prune information leaks
  // in (since none was passed)
  assertEquals(
    rendered,
    "chore(release): orders 0.4.0\n\n- orders 0.3.0 → 0.4.0 (1 feat)",
  );
});

Deno.test("renderCommitMessage on a 100%-prune run produces a meaningful message (audit finding 3)", () => {
  // Given a Plan with no pending bumps but one unresolved reference,
  // and `prunedUnresolved: true` (the caller saw --prune and acted)
  const plan = buildPlan({
    unresolvedReferences: [{ record: "ghost.md", reference: "ghost" }],
  });

  // When the commit message is rendered with the prune flag on
  const rendered = renderCommitMessage({ plan, prunedUnresolved: true });

  // Then both summary and details surface the prune — pre-fix this
  // was `chore(release): \n\n`, which is the audit-finding bug
  assertEquals(
    rendered,
    "chore(release): prune 1 unresolved\n\n- pruned unresolved reference 'ghost' (ghost.md)",
  );
});

Deno.test("renderCommitMessage on a mixed bumps + prune run lists both, with bumps first", () => {
  // Given one bump AND one pruned unresolved reference in the same run
  const plan = buildPlan({
    pending: [
      {
        package: "billing",
        currentVersion: "0.1.2",
        projectedVersion: "0.1.3",
        bump: "patch",
        stability: "Unstable",
        changeCounts: { feat: 0, fix: 1, breaking: 0 },
        records: ["fix-rounding.md"],
        constraintUpdates: [],
      },
    ],
    unresolvedReferences: [{ record: "ghost.md", reference: "ghost" }],
  });

  // When rendered with the prune flag on
  const rendered = renderCommitMessage({ plan, prunedUnresolved: true });

  // Then bumps precede prunes in both summary and details — the
  // bumps are the primary change; prunes are bookkeeping that rides
  // along
  assertEquals(
    rendered,
    "chore(release): billing 0.1.3, prune 1 unresolved\n\n" +
      "- billing 0.1.2 → 0.1.3 (1 fix)\n" +
      "- pruned unresolved reference 'ghost' (ghost.md)",
  );
});

Deno.test("renderCommitMessage ignores unresolvedReferences when prunedUnresolved is false (e.g. when --prune wasn't passed)", () => {
  // Given a Plan with unresolved references but `prunedUnresolved`
  // off — the run halted on the unresolved ref so the commit
  // message shouldn't claim it was dropped (this is the not-passed
  // case; runs that DO halt won't reach renderCommitMessage at all,
  // but the defensive contract matters)
  const plan = buildPlan({
    pending: [
      {
        package: "orders",
        currentVersion: "0.3.0",
        projectedVersion: "0.4.0",
        bump: "minor",
        stability: "Unstable",
        changeCounts: { feat: 1, fix: 0, breaking: 0 },
        records: ["multi-currency.md"],
        constraintUpdates: [],
      },
    ],
    unresolvedReferences: [{ record: "ghost.md", reference: "ghost" }],
  });

  // When rendered with the prune flag explicitly off
  const rendered = renderCommitMessage({ plan, prunedUnresolved: false });

  // Then the unresolved reference is omitted — the commit reflects
  // only the bumps
  assertEquals(
    rendered,
    "chore(release): orders 0.4.0\n\n- orders 0.3.0 → 0.4.0 (1 feat)",
  );
});
