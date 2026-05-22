---
type: feat
packages:
  - '@seshat/cli'
---

Introduce @seshat/cli — a minimal argv-dispatch framework

First cut of a reusable CLI framework, carved out of dv's main.ts:

- `defineCli` takes a CliConfig (name, version, usage, commands,
  optional reportError) and returns a Cli with run(argv).
- `defineCommand` is an identity helper that captures the literal
  FlagSpec map via TS inference so each command's runner sees its
  precise flag shape — without it, `const cmd: CommandSpec = {...}`
  lands on the default generic and widens FlagsOf to the union of
  every kind, breaking runner typing.
- FlagSpec is per-flag (kind-tagged: 'boolean' | 'string' | 'collect',
  optional alias and description). The framework lowers it to
  parseArgs' string-array shape internally.
- Internal UnknownFlagError throws through parseArgs' synchronous
  `unknown` callback and is converted to 'unknown flag …' + exit 2 by
  defineCli. The previous Deno.exit(2) call inline in apps/cli/main.ts
  was unmockable; this trick makes dispatch testable.
- Dispatch rules: empty argv or top-level --help/-h → top-level help;
  --version/-V → print version; unknown subcommand → 'unknown command'
  + exit 2; per-command --help/-h → that command's usage; unknown flag
  → 'unknown flag' + exit 2; runner throws → reportError + exit 1.

Intentionally NOT in scope: TTY rendering / color, prompts, custom
error classes, --json error envelopes, auto-derived --no-foo flags,
nested subcommands, fluent builder API. Errors are deferred for a
more sophisticated design later.
