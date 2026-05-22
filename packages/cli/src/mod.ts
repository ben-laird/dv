// Public surface of @seshat/cli — a minimal argv-dispatch CLI
// framework. Tiny on purpose: register subcommands with typed flag
// specs, get a `Cli` that routes argv. No TTY, no prompts, no error
// machinery beyond a single reportError hook. Future work layers atop.

export { defineCommand } from "./command-spec.ts";
export type {
  Cli,
  CliConfig,
  CommandRunner,
  CommandSpec,
  FlagSpec,
  FlagsOf,
  RunnerContext,
} from "./command-spec.ts";
export { defineCli } from "./define-cli.ts";
