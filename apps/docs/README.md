# apps/docs — documentation site

The VitePress site that publishes `dv`'s documentation. Renders content
sourced from `../../specs/` (the spec library is the source of truth;
this app turns it into a browsable site).

## Stack

- **VitePress** under Deno v2 via the `npm:` specifier. No standalone
  `package.json` and no `npm install` — `deno task dev` handles the
  `node_modules/` layout automatically (`nodeModulesDir: "auto"`).

## Run

```sh
cd apps/docs
deno task dev       # local dev server
deno task build     # production build → .vitepress/dist
deno task preview   # serve the built site
```

## Layout

```text
apps/docs/
├── deno.json              # workspace member + vitepress dep + tasks
├── .vitepress/
│   └── config.ts          # srcDir: "../.."; rewrites strip the
│                          # specs/ prefix; sidebar links each spec
└── index.md               # landing page (site-only content)
```

Spec content stays in `../../specs/` and is rendered straight from
there. New spec files become pages automatically once they exist; they
only need a sidebar entry in `.vitepress/config.ts` to be discoverable
in the nav.

## Deploy target

TBD. Likely a static host (GitHub Pages, Cloudflare Pages, Netlify) — the
choice doesn't affect the source layout.
