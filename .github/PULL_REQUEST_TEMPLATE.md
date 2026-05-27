<!--
Thanks for sending a PR. A few quick conventions to make review fast:

- For user-visible changes (a new feature, a bug fix, a breaking change),
  author a Record under .dv/records/ in the same PR:
    dv add --type feat --packages '@seshat/dv' --notes "..."
  If your change is internal cleanup with no user-visible effect, no
  Record is needed.

- Keep one concern per PR. dv is a small tool and reviewers move
  faster on tight diffs.

- Tests aren't blocking for spec/docs changes, but if you touched
  src/, run `deno task test` and `deno task check` before pushing.
-->

## What changes

<!-- One or two sentences. The reader has the diff; tell them the why. -->

## Type

- [ ] Bug fix (`fix` Record, or no Record if not user-visible)
- [ ] New feature (`feat` Record)
- [ ] Breaking change (`feat!` or `fix!` Record — explain the migration below)
- [ ] Docs / internal cleanup (no Record)

## Notes for the reviewer

<!--
Anything non-obvious: a design decision you made, an alternative you
rejected, an area you'd specifically like a second pair of eyes on.
"None" is a fine answer.
-->

## Checklist

- [ ] `deno task fmt`, `lint`, `check`, and `test` pass locally (or rationale below)
- [ ] If user-visible: a Record under `.dv/records/` in this PR
- [ ] If touching the plugin contract: `specs/plugin-contract.md` updated to match
- [ ] If touching CLI flags or output: `specs/cli.md` updated to match
