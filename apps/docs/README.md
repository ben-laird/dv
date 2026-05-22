# apps/docs — documentation site

The VitePress site that publishes `dv`'s documentation. Renders content
sourced from `../../specs/` (the spec library is the source of truth; this
app turns it into a browsable site).

Not yet scaffolded. To initialize:

```sh
cd apps/docs
npm create vitepress@latest .
```

Pick the in-place option and point the default theme's `srcDir` (or its
sidebar/nav) at `../../specs/`. Treat the generated `package.json` as a
single-package Node project; this app is **not** a Deno workspace member.

## Deploy target

TBD. Likely a static host (GitHub Pages, Cloudflare Pages, Netlify) — the
choice doesn't affect the source layout.
