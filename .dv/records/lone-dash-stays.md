---
type: fix
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/41
---

# Treat a lone `-` as a word, not an unknown flag

`mycli add -` failed with `unknown flag '-'`, and a router skipped `-` as if
it were a flag. By Unix convention a bare `-` is an ordinary argument (it
often means stdin), so leaves now receive it as a positional word and routers
treat it as a subcommand name. A value flag takes it as its value in every
spelling: `--title -`, `-t -` and `--title=-` all set `title` to `-`. `-x`,
`--x` and `-5` before `--` are still refused as unknown flags.
