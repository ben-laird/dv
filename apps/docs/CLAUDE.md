# apps/docs/ — documentation site conventions

Loaded automatically when working inside `apps/docs/`. Assumes you've read
`.claude/CLAUDE.md`.

This is the **VitePress site** that publishes `dv`'s docs. Two facts about
it are load-bearing:

- **Node, not Deno.** This app uses npm/pnpm and Vite. It is *not* a Deno
  workspace member and is not listed in the root `deno.json`'s `workspace`
  array. Don't add it.
- **`specs/` is upstream.** The content rendered here lives in `../../specs/`
  — language, design, cli, record-format, config-format, plugin-contract,
  schemas, walkthrough, v1-scope. The site's job is to present it; the
  spec library remains the source of truth. If a doc reads wrong on the
  site, fix it in `specs/`, not here.

## Editing rules

- Don't fork spec content into `apps/docs/`. Reference `../../specs/*.md`
  from the VitePress config (sidebar, `srcDir`, includes) so there's one
  copy.
- Site-only content (landing page, theming, custom components) lives here.
- Keep dependencies minimal. VitePress + its default theme is the baseline;
  add plugins only when a doc actually needs them.

## Don't invent

The spec library is authoritative on what `dv` *does*. This app decides
only how to *present* it. Navigation order, grouping, and titles can be
opinionated here; behavior described in `../../specs/` is not.
