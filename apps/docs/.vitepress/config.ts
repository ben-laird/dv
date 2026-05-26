import { defineConfig } from "vitepress";

// VitePress site for dv.
//
// Source layout (`apps/docs/CLAUDE.md`): the spec library lives in
// `../../specs/` and is the source of truth. The site renders those
// files directly via `srcDir: '../..'` (anchoring at the repo root)
// plus `rewrites` that strip the `specs/` prefix from URLs, so
// `specs/language.md` is served as `/language`. Site-only content
// (landing page, theme) stays under `apps/docs/`.
//
// Why srcDir at the repo root rather than `srcDir: '../../specs'`:
// the landing page (`apps/docs/index.md`) needs to live somewhere
// inside `srcDir` to be a page, and we don't want it polluting
// `specs/`. Anchoring at the repo root lets both trees coexist
// without symlinks or build-time copies (`apps/docs/CLAUDE.md` is
// explicit that we should not fork spec content).
//
// `srcExclude` keeps the source set tight: every meta/README/CLAUDE
// file that exists for other reasons (orientation, package
// scaffolding, agent guidance) stays out of the published site.

export default defineConfig({
  title: "dv",
  description:
    "A language-agnostic, git-native changelog CLI for monorepos.",
  cleanUrls: true,
  // The spec library legitimately links into source code (e.g. a
  // module path in `apps/cli/src/subtools/...`). Those aren't
  // pages on this site — they're navigational hints for readers
  // browsing the repo on GitHub. Tell VitePress not to flag them
  // as dead. Function form lets us be precise: only ignore links
  // that point at source dirs, not arbitrary typos in spec text.
  ignoreDeadLinks: [/^\.?\.?\/.*\/(apps|packages|examples)\//],
  srcDir: "../..",
  // Map specs/foo.md → /foo so spec URLs read naturally. The
  // landing page sits at apps/docs/index.md and is the
  // explicit root via a self-rewrite (Vitepress treats the
  // un-rewritten apps/docs/index.md as a buried URL otherwise).
  rewrites: {
    "apps/docs/index.md": "index.md",
    "specs/:slug.md": ":slug.md",
  },
  // Excludes anything that isn't a published page. The spec
  // library + the landing page are the only sources; every other
  // markdown file in the tree exists for orientation, package
  // scaffolding, or agent guidance.
  srcExclude: [
    "**/README.md",
    "**/CLAUDE.md",
    "CONVENTIONS.md",
    "ROADMAP.md",
    "**/CHANGELOG.md",
    "**/HISTORY.md",
    "examples/**",
    "packages/**",
    ".dv/**",
    "node_modules/**",
    // schemas/ holds JSON Schemas plus a brief README, not pages.
    "specs/schemas/**",
  ],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/walkthrough" },
      { text: "Reference", link: "/cli" },
    ],
    // Sidebar follows the read order from apps/docs/CLAUDE.md:
    // language first (the ubiquitous vocabulary), then design
    // (the why), then the per-spec references. v1-scope sits in
    // its own section as the product-shape doc.
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Walkthrough", link: "/walkthrough" },
          { text: "Language", link: "/language" },
          { text: "Design", link: "/design" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/cli" },
          { text: "Record format", link: "/record-format" },
          { text: "Config format", link: "/config-format" },
          { text: "Plugin contract", link: "/plugin-contract" },
        ],
      },
      {
        text: "Product",
        items: [{ text: "v1 scope", link: "/v1-scope" }],
      },
    ],
    socialLinks: [],
  },
});
