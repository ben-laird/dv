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
- **Two content sources, one site.** The site renders content from
  two trees:
  - `apps/docs/content/` — user-facing pages written for adoption.
    Tutorial (`getting-started.md`), pitch (`why-dv.md`), Concepts
    (Records / Packages and plugins / Two-phase release / SemVer and
    stability), and (later) Guides.
  - `../../specs/` — the internal spec library. Only the **reference**
    specs (`cli`, `config-format`, `record-format`, `plugin-contract`)
    are surfaced on the public site, republished under `/reference/*`.
    The other specs (`language`, `design`, `walkthrough`, `v1-scope`)
    are **deliberately not on the public site** — they're internal
    design docs using formal notation, written for implementers /
    AI agents, and would confuse end users. They stay in `specs/`
    as the team's source of truth.
- **Two audiences, two voices.** When editing:
  - End-user content lives in `apps/docs/content/` — write for
    someone evaluating or adopting `dv`, in plain language. Link
    to Concept pages instead of repeating definitions.
  - Internal specs in `../../specs/` stay terse and formal — they're
    the design source of truth for the team. If a spec needs to be
    user-facing, rewrite it as a Concept page in `apps/docs/content/`
    rather than softening the spec itself.
- **`srcDir` is the repo root.** Config sets `srcDir: "../.."` so
  both trees fit inside the source set without symlinks or build-time
  copies. `rewrites` controls URLs; `srcExclude` keeps everything
  else (READMEs, CLAUDEs, internal specs, examples, packages) off
  the public site. New pages need both a rewrite entry (if the
  filename differs from the URL) and a sidebar entry to be
  discoverable.

## Tasks

From `apps/docs/`:

- `deno task dev` — local dev server with HMR
- `deno task build` — production build into `.vitepress/dist`
- `deno task preview` — serve the built site

## Editing rules

- **Reference specs are republished, not forked.** The four reference
  specs (`cli`, `config-format`, `record-format`, `plugin-contract`)
  are surfaced via `rewrites` from `../../specs/`. To change their
  content, edit the spec. New user-facing content (Concepts, Guides,
  tutorials) lives in `apps/docs/content/` and is the right place
  for adoption-oriented material.
- **Don't promote internal specs to public pages without rewriting
  them.** `language.md`, `design.md`, `walkthrough.md`, and
  `v1-scope.md` use formal notation and assume implementer context.
  If a Concept page needs material from one of them, distill it in
  plain language for the public site — don't just publish the spec.
- Keep dependencies minimal. VitePress + its default theme is the
  baseline; add plugins only when a doc actually needs them.

## Don't invent

The spec library is authoritative on what `dv` *does*. This app decides
only how to *present* it. Navigation order, grouping, and titles can be
opinionated here; behavior described in `../../specs/` is not.
