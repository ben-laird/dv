import { defineConfig } from "vitepress";

// VitePress site for dv. The public site is end-user-facing — it
// teaches dv to someone evaluating or adopting it, and exposes the
// reference docs for day-to-day use. The internal spec library at
// `../../specs/` is separate: those docs target the implementer
// (and AI coding agents picking up the project), use formal
// notation, and are the design source of truth for the team — not
// adoption material.
//
// Source layout:
//
//   apps/docs/
//     index.md                  — landing
//     content/
//       getting-started.md      — 5-min tutorial
//       why-dv.md               — pitch + comparison
//       concepts/*.md           — Explanation (end-user voice)
//       guides/*.md             — How-To (task-oriented; grows over time)
//     .vitepress/config.ts      — this file
//
//   specs/
//     cli.md, config-format.md, record-format.md,
//     plugin-contract.md        — reference; surfaced on the public
//                                 site under /reference/* via rewrites
//     language.md, design.md, walkthrough.md, v1-scope.md
//                               — internal; NOT on the public site
//
// `srcDir` anchors at the repo root so both trees fit inside the
// source set without symlinks or build-time copies. `rewrites`
// maps each source path to its clean public URL; `srcExclude`
// keeps everything else (READMEs, CLAUDEs, internal specs,
// examples, packages) out of the published surface.

export default defineConfig({
  title: "dv",
  description:
    "A git-native changelog CLI for monorepos. Records, not commit messages.",
  cleanUrls: true,
  // Two classes of "dead" links exist in the spec content that are
  // intentional and shouldn't fail the build:
  //
  //   1. Source-code breadcrumbs (apps/cli/src/..., packages/...,
  //      examples/...) — useful when reading specs on GitHub, but
  //      they're not pages on this site.
  //
  //   2. Cross-spec links to *internal* specs (language, design,
  //      walkthrough, v1-scope). The reference specs we publish
  //      (cli, config-format, record-format, plugin-contract)
  //      link to each other and to internal specs as siblings —
  //      that's correct in the spec library, but the internal
  //      ones aren't on the public site, so the link names look
  //      "dead" to VitePress. Allowlist them by name.
  ignoreDeadLinks: [
    /^\.?\.?\/.*\/(apps|packages|examples)\//,
    /^\.?\.?\/(language|design|walkthrough|v1-scope)$/,
  ],
  srcDir: "../..",
  // Map source paths to public URLs. The directory layout follows
  // the Diátaxis split: tutorials/ teach by doing, guides/ are
  // task-oriented how-tos, concepts/ are explanation, reference/
  // is information lookup. about/ is non-Diátaxis (pitch and
  // positioning material that doesn't fit the four-mode framework).
  //
  // Internal specs (language, design, walkthrough, v1-scope) stay
  // off the public site entirely — see srcExclude.
  rewrites: {
    "apps/docs/index.md": "index.md",
    "apps/docs/content/:slug.md": ":slug.md",
    "apps/docs/content/about/:slug.md": "about/:slug.md",
    "apps/docs/content/tutorials/:slug.md": "tutorials/:slug.md",
    "apps/docs/content/concepts/:slug.md": "concepts/:slug.md",
    "apps/docs/content/guides/:slug.md": "guides/:slug.md",
    "apps/docs/content/reference/:slug.md": "reference/:slug.md",
    // Keep the original filenames in the URL so cross-references
    // from within the spec library (e.g. `./config-format`) keep
    // resolving without rewrite-aware link-mangling. The sidebar
    // labels them with friendly names regardless.
    "specs/cli.md": "reference/cli.md",
    "specs/config-format.md": "reference/config-format.md",
    "specs/record-format.md": "reference/record-format.md",
    "specs/plugin-contract.md": "reference/plugin-contract.md",
  },
  // Keep the public source surface tight: only the explicitly
  // rewritten paths above survive. Everything else is excluded.
  // (Vitepress applies these as glob excludes against the srcDir
  // tree; the rewrites above pull specific files back in.)
  srcExclude: [
    "**/README.md",
    "**/CLAUDE.md",
    "CONVENTIONS.md",
    "ROADMAP.md",
    "**/CHANGELOG.md",
    "**/HISTORY.md",
    "examples/**",
    "packages/**",
    "apps/cli/**",
    ".dv/**",
    "node_modules/**",
    // Internal specs: language is the implementer's vocabulary
    // (formal set-theory notation); design is the per-decision
    // rationale; walkthrough is a long-form reference; v1-scope
    // is the product-shape doc. None of these are adoption
    // material. The team-facing source of truth stays in /specs/;
    // the public site teaches dv in its own voice.
    "specs/language.md",
    "specs/design.md",
    "specs/walkthrough.md",
    "specs/v1-scope.md",
    "specs/schemas/**",
  ],
  themeConfig: {
    nav: [
      { text: "Get started", link: "/getting-started" },
      { text: "Reference", link: "/reference/cli" },
      { text: "Why dv?", link: "/about/why-dv" },
    ],
    // Sidebar shape follows the Diátaxis four-mode framework
    // (https://diataxis.fr): Tutorials teach by doing, Concepts
    // explain the model, Guides solve specific tasks, Reference is
    // for lookup. "About" sits outside the framework — pitch and
    // positioning material doesn't fit any of the four modes, and
    // pretending it's a tutorial blurs the boundary for readers
    // arriving to "learn dv."
    //
    // Adoption journey reads top-to-bottom: a new user starts with
    // Getting started (a Tutorial), drops into a Concept page when
    // something feels unfamiliar, hits a Guide when they want to
    // *do* something specific, and lives in Reference once dv is
    // part of their daily workflow. About is for the
    // pre-evaluation reader deciding whether to invest.
    sidebar: [
      {
        text: "Tutorials",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Write a plugin", link: "/tutorials/write-a-plugin" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Records", link: "/concepts/records" },
          {
            text: "Packages and plugins",
            link: "/concepts/packages-and-plugins",
          },
          {
            text: "Two-phase release",
            link: "/concepts/two-phase-release",
          },
          {
            text: "SemVer and stability",
            link: "/concepts/semver-and-stability",
          },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Cut a release", link: "/guides/cut-a-release" },
          { text: "CI integration", link: "/guides/ci-integration" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Config", link: "/reference/config-format" },
          { text: "Records", link: "/reference/record-format" },
          { text: "Plugin contract", link: "/reference/plugin-contract" },
          { text: "Troubleshooting", link: "/reference/troubleshooting" },
        ],
      },
      {
        text: "About",
        items: [{ text: "Why dv?", link: "/about/why-dv" }],
      },
    ],
    socialLinks: [],
  },
});
