// Public surface of the history Subtool: renders long-form HISTORY
// release sections from Records and splices them into per-Package
// HISTORY.md files. Opt-in via `history.enabled` in config
// (specs/config-format.md § history).

export { upsertHistorySection } from "./io.ts";
export {
  buildFreshHistory,
  type PrependHistorySectionArgs,
  prependHistorySection,
} from "./prepend.ts";
export {
  type RenderHistorySectionArgs,
  renderHistorySection,
} from "./render.ts";
