// Public surface of the changelog Subtool: renders Keep a Changelog
// release sections from Records and splices them into per-Package
// CHANGELOG.md files (specs/design.md § Per-package CHANGELOG.md).

export { upsertChangelogSection } from "./io.ts";
export {
  buildFreshChangelog,
  type PrependChangelogSectionArgs,
  prependChangelogSection,
} from "./prepend.ts";
export {
  type RenderReleaseSectionArgs,
  renderReleaseSection,
} from "./render.ts";
