# History

Long-form release notes for this Package. Each version section carries
one h3 subsection per Record consumed during that release, with the
Record's body prose verbatim. For terse one-line bullets, see
CHANGELOG.md.

## [1.0.0] - 2026-05-23

## [0.3.0] - 2026-05-22

### Add opt-in HISTORY.md long-form release notes

A new `history` subtool writes a per-Package `HISTORY.md` alongside
`CHANGELOG.md` when `history.enabled: true` in
`.dv/config.yaml`. The two documents are complementary:
CHANGELOG stays terse per Keep a Changelog (single-line bullets);
HISTORY carries each Record's full body prose under per-version h3
subsections.

Opt-in by default — every existing dv repo sees zero behavior change
on the next bump. Format mirrors CHANGELOG's: `## [version] - date`
sections with the same splice rule (above the first non-`Unreleased`
heading) and a HISTORY-specific preamble that explicitly points
readers at CHANGELOG.md for terse bullets.

The renderer reuses `extractHeadline` from the changelog subtool so
the headline semantics stay aligned. Records leading with an h1
become an h3 subsection in HISTORY with the body prose verbatim
below it. Records without an h1 (pre-v1 convention) fall back to
first-non-empty-line as the title and the rest of the body as the
entry content. Breaking flavors get no special treatment in HISTORY
— HISTORY is narrative, not structured; CHANGELOG keeps the
`**BREAKING**` emphasis.

Same `overrides[].history` shape as `overrides[].changelog` for
per-Package customization. Config + flag parity holds: `history` is
config-only because it's repo-definition, not runtime behavior
(like `changelog.location`).
