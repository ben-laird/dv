// Per-run context shared across every dv command's router handler.
// Stage 1 keeps it minimal so the shape can grow as parent routers
// actually need it; future iterations may add lazy loaders (e.g.
// `repoRootPath?: string` filled by a root-router pre-handler so
// each leaf doesn't repeat `requireRepoRoot()`).
//
// Lives outside any one command so the type is the framework-level
// agreement, not a per-leaf concern.

export interface DvCtx {
  // The exact argv dv was invoked with at the binary boundary.
  // Used by the output-mode resolver to pre-scan for `--json` /
  // `--no-color` without having to thread the original argv
  // through every router hop.
  binaryArgv: string[];
}
