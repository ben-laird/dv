# apps/docs/ — documentation site conventions

Loaded automatically when working inside `apps/docs/`. Assumes you've read
`.claude/CLAUDE.md`.

This is the **VitePress site** that publishes `dv`'s docs. Two facts about
it are load-bearing:

- **Deno workspace member.** VitePress runs under Deno via the `npm:`
  specifier (Deno v2's npm compat). The root `deno.json` sets
  `"nodeModulesDir": "auto"` — that field only takes effect at the
  workspace root, never in a member — so Vite gets the `node_modules/`
  layout it expects. No standalone `package.json`, no `npm install`.
- **Peer deps are declared explicitly.** Deno's npm resolver doesn't
  auto-install peer dependencies the way npm/pnpm do. VitePress's main
  peers (`vue`, `@vueuse/core`, `@vue/devtools-api`, `@docsearch/*`)
  live in this package's `imports` map so Vite can find them in
  `node_modules/`. If you see a fresh "failed to resolve" error after
  upgrading VitePress, add the missing dep here.
- This `deno.json` deliberately omits `name`/`version`/`exports` — the
  site isn't a publishable library, just a workspace member with its
  own tasks and deps.
- **`specs/` is upstream.** The content rendered here lives in `../../specs/`
  — language, design, cli, record-format, config-format, plugin-contract,
  schemas, walkthrough, v1-scope. The site's job is to present it; the
  spec library remains the source of truth. If a doc reads wrong on the
  site, fix it in `specs/`, not here.
- **`srcDir` is the repo root, not `apps/docs/`.** The config sets
  `srcDir: "../.."` so the spec library (`../../specs/*.md`) and the
  landing page (`apps/docs/index.md`) both live inside the source
  tree. `rewrites` maps `specs/foo.md → /foo` so URLs read naturally;
  `srcExclude` filters out READMEs, CLAUDEs, `examples/`, `packages/`,
  and other non-page markdown. New spec files become pages
  automatically — but they need an explicit entry in `themeConfig.sidebar`
  to appear in the nav.

## Tasks

From `apps/docs/`:

- `deno task dev` — local dev server with HMR
- `deno task build` — production build into `.vitepress/dist`
- `deno task preview` — serve the built site

## Editing rules

- Don't fork spec content into `apps/docs/`. Reference `../../specs/*.md`
  from the VitePress config (sidebar, `srcDir`, includes, or rewrites) so
  there's exactly one copy.
- Site-only content (landing page, theming, custom components) lives here.
- Keep dependencies minimal. VitePress + its default theme is the baseline;
  add plugins only when a doc actually needs them.

## Don't invent

The spec library is authoritative on what `dv` *does*. This app decides
only how to *present* it. Navigation order, grouping, and titles can be
opinionated here; behavior described in `../../specs/` is not.
