// Public surface of the git Substrate (specs/design.md § Capability
// decomposition: git is a substrate, not a capability of its own). Used
// by `dv version` to gate the run, stage the changes, and produce the
// version-bump commit (the Release PR in a review-gated workflow).

export { type AssertCleanTreeArgs, assertCleanTree } from "./clean-tree.ts";
export {
  type CommitChangesArgs,
  type CommitChangesResult,
  commitChanges,
} from "./commit.ts";
export {
  type AssertNoUnstagedFinalizeDriftArgs,
  assertNoUnstagedFinalizeDrift,
} from "./finalize-drift.ts";
export { type PushTagsArgs, pushTags } from "./push.ts";
export { findRepoRoot, requireRepoRoot } from "./repo-root.ts";
export { type StageFilesArgs, stageFiles } from "./stage.ts";
export { type MintTagArgs, mintTag } from "./tag.ts";
export {
  type ListTagsMatchingArgs,
  listTagsMatching,
  type TagExistsArgs,
  tagExists,
} from "./tag-query.ts";
