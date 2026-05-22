// Public surface of @seshat/cli — a minimal argv-dispatch CLI
// framework. Tiny on purpose: register subcommands with typed flag
// specs, get a `Cli` that routes argv. No TTY, no prompts, no error
// machinery beyond a single reportError hook. Future work layers atop.

export type {
  Cli,
  CliConfig,
  CommandRunner,
  CommandSpec,
  FlagSpec,
  FlagsOf,
  RunnerContext,
} from "./command-spec.ts";

// defineCli lands in step 3; this module only exports types until then
// so the workspace member type-checks while the implementation grows.
