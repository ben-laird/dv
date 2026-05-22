# apps/docs/ — documentation site conventions

Loaded automatically when working inside `apps/docs/`. Assumes you've read
`.claude/CLAUDE.md`.

This is the **VitePress site** that publishes `dv`'s docs. Two facts about
it are load-bearing:

- **Deno workspace member.** VitePress runs under Deno via the `npm:`
  specifier (Deno v2's npm compat). The package's `deno.json` sets
  `"nodeModulesDir": "auto"` so Vite gets the `node_modules/` layout it
  expects. No standalone `package.json`, no `npm install`.
- **`specs/` is upstream.** The content rendered here lives in `../../specs/`
  — language, design, cli, record-format, config-format, plugin-contract,
  schemas, walkthrough, v1-scope. The site's job is to present it; the
  spec library remains the source of truth. If a doc reads wrong on the
  site, fix it in `specs/`, not here.

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
