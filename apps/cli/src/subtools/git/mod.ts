// Public surface of the git Substrate (specs/design.md § Capability
// decomposition: git is a substrate, not a capability of its own). Used
// by `dv version` to gate the run, stage the changes, and produce the
// Release PR commit.

export { type AssertCleanTreeArgs, assertCleanTree } from "./clean-tree.ts";
export {
  type CommitChangesArgs,
  type CommitChangesResult,
  commitChanges,
} from "./commit.ts";
export { findRepoRoot, requireRepoRoot } from "./repo-root.ts";
export { type StageFilesArgs, stageFiles } from "./stage.ts";
