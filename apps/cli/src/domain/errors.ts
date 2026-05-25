import { CliError, type CliErrorInit } from "@seshat/cli";

// dv's error model. DvErrorShape is the source of truth for every
// error code dv produces — the discriminated union welds each code
// to its per-code `context` shape, so throw sites get TS-checked
// pairing (you can't supply the wrong context for a code) and catch
// sites narrow `err.kind.code` together with `err.kind.context`.
//
// Per `specs/v1-scope.md` § Automation surface, codes are part of
// dv's public contract — adding, renaming, or removing one is a
// breaking change to the --json envelope consumers depend on.
//
// Conventions for adding a new code:
//   - Group with related codes in the union below (subsystem
//     comments mark the sections).
//   - If the error carries machine-readable state callers should
//     branch on, declare a `context` field with its shape. Keep
//     values JSON-serializable.
//   - If there's no useful structured context, just declare
//     `{ code: "..." }` — the variant has no context arm.
//   - Add a hint at the throw site when the user can act on it
//     (specs/v1-scope.md doesn't formalize hints, but they're the
//     biggest UX win of structured errors over `dv: <message>`).

export type DvErrorShape =
  // === wrap: framework auto-wrapped non-DvError throws ============
  | { code: "unknown" }

  // === init ======================================================
  | {
      code: "init-not-a-directory";
      context: { path: string };
    }

  // === config: parse + extends chain =============================
  | { code: "config-not-found"; context: { configFilePath: string } }
  | { code: "config-parse"; context: { configFilePath: string } }
  | { code: "config-shape"; context: { configFilePath?: string } }
  | { code: "config-unknown-key"; context: { configFilePath: string } }
  | {
      code: "config-legacy-use-shape";
      context: { configFilePath: string; legacyValue: string };
    }
  | { code: "extends-cycle"; context: { configFilePath: string } }

  // === discovery + plugins =======================================
  | {
      code: "package-conflict";
      context: { path: string; pluginA: string; pluginB: string };
    }
  | { code: "plugin-not-found"; context: { pluginReferenceKey: string } }
  | {
      code: "plugin-command-not-found";
      context: { command: string };
    }
  | {
      code: "plugin-run-parse";
      context: { runValue: string };
    }
  | {
      code: "plugin-not-executable";
      context: { pluginPath: string; opName: string };
    }
  | {
      code: "plugin-exit-nonzero";
      context: { pluginPath: string; opName: string; exitCode: number };
    }
  | {
      code: "plugin-timeout";
      context: { pluginPath: string; opName: string; timeoutMs: number };
    }
  | {
      code: "plugin-bad-response";
      context: { pluginPath: string; opName: string };
    }
  | {
      code: "plugin-error";
      context: { pluginPath: string; opName: string };
    }
  | {
      code: "plugin-contract-mismatch";
      context: {
        pluginPath: string;
        pluginContractVersion: string;
        expectedContractVersion: string;
      };
    }

  // === records: parse + frontmatter ==============================
  | { code: "frontmatter-missing"; context: { recordPath: string } }
  | { code: "frontmatter-shape"; context: { recordPath: string } }
  | { code: "body-empty"; context: { recordPath: string } }

  // === rename ledger =============================================
  | { code: "ledger-parse"; context: { ledgerPath: string } }
  | { code: "ledger-shape"; context: { ledgerPath: string } }
  | {
      code: "ledger-duplicate-edge";
      context: { ledgerPath: string; from: string };
    }
  | {
      code: "ledger-cycle";
      context: { ledgerPath: string; startReference: string };
    }

  // === add =======================================================
  | { code: "add-flags-required" }
  | { code: "add-no-packages" }
  | { code: "add-no-packages-selected" }
  | { code: "add-aborted" }
  | { code: "add-empty-body" }
  | { code: "add-unknown-package"; context: { unknownPackages: string[] } }
  | { code: "add-slug-exhausted"; context: { attempts: number } }

  // === editor (used by dv add) ===================================
  | { code: "editor-parse" }
  | { code: "editor-failed"; context: { command: string; exitCode: number } }

  // === git substrate =============================================
  | { code: "git-missing" }
  | { code: "not-a-git-repo" }
  | { code: "dirty-tree" }
  | { code: "git-status-failed" }
  | { code: "git-stage-failed" }
  | { code: "git-commit-failed" }
  | { code: "git-rev-parse-failed" }
  | { code: "git-tag-failed"; context: { tag: string } }
  | { code: "git-tag-list-failed" }
  | { code: "git-push-failed"; context: { tagNames: string[] } }

  // === version pipeline ==========================================
  | { code: "version-parse"; context: { rawText: string } }
  | { code: "malformed-records"; context: { failureCount: number } }
  | { code: "unresolved-reference"; context: { count: number } }
  | { code: "internal-plan-mismatch" }

  // === release pipeline ==========================================
  | { code: "confirmation-required" }
  | { code: "release-cancelled" }
  | {
      code: "release-op-failed";
      context: { package: string; tag: string };
    }
  | {
      code: "release-partial-failure";
      context: { failedCount: number; totalAttempted: number };
    }

  // === v1 promotion ==============================================
  | {
      code: "v1-package-not-found";
      context: { requestedPackage: string; knownPackages: string[] };
    }
  | {
      code: "v1-already-stable";
      context: { package: string; currentVersion: string };
    }
  | { code: "v1-cancelled" };

// DvError is the throw type for every dv-internal failure. Extends
// CliError with the DvErrorShape union pinned, so throw sites get
// typed code+context pairing and catch sites narrow naturally
// against `err.kind.code`.
//
// Subclasses (RecordError, RenameLedgerError) extend DvError to
// preserve the `instanceof` discrimination some callers do (e.g.
// dv validate's per-record source field). Their per-class extras
// (recordPath, ledgerPath) live in `kind.context` and are exposed
// as readonly getters for back-compat with read sites.

export class DvError extends CliError<DvErrorShape> {
  constructor(init: CliErrorInit<DvErrorShape>) {
    super(init);
    this.name = "DvError";
  }
}
