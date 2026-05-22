// Public surface of the tagging Subtool: tag formatting + the git
// ops a release pipeline composes (mint, push, query). The git
// substrate owns the mechanics; this subtool owns the per-Package
// abstraction (formatTag plus the lifecycle semantics in dv release).

export {
  type ListTagsMatchingArgs,
  listTagsMatching,
  type MintTagArgs,
  mintTag,
  type PushTagsArgs,
  pushTags,
  type TagExistsArgs,
  tagExists,
} from "../git/mod.ts";
export {
  type AwaitingReleaseEntry,
  type ComputeAwaitingReleaseArgs,
  computeAwaitingRelease,
  type PackageWithCurrentVersion,
} from "./await-release.ts";
export { type FormatTagArgs, formatTag } from "./format.ts";
