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
│   └── config.ts          # srcDir: "../.."; rewrites map both content
│                          # and reference specs into clean URLs
├── index.md               # landing page
└── content/               # adoption-oriented user content
    ├── getting-started.md
    ├── why-dv.md
    ├── concepts/          # Explanation pages
    │   ├── records.md
    │   ├── packages-and-plugins.md
    │   ├── two-phase-release.md
    │   └── semver-and-stability.md
    └── guides/            # How-to pages (grows over time)
```

Reference specs (`cli`, `config-format`, `record-format`,
`plugin-contract`) are surfaced via `rewrites` from `../../specs/` and
published under `/reference/*`. Internal specs (`language`, `design`,
`walkthrough`, `v1-scope`) stay in `specs/` and don't appear on the
public site — they're design docs for the team.

## Deploy target

TBD. Likely a static host (GitHub Pages, Cloudflare Pages, Netlify) — the
choice doesn't affect the source layout.
