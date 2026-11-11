---
type: fix
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/39
---

# Treat --help and -h after `--` as words, not a help request

`mycli add -- --help` printed the leaf's help instead of passing `--help` to
it. Everything after `--` is a positional word, never a switch, so routers
and leaves now look for `--help` and `-h` only before a `--`. Help before
`--` works as before at every level.
