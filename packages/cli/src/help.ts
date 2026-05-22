import type { CliConfig } from "./command-spec.ts";

// Help-text formatting. defineCli prints `usage` verbatim for top-level
// --help and prints a command's own `usage` for per-command --help.
// Future iterations may render flags from FlagSpec.description, but for
// now usage strings are hand-written and trusted.

export function formatTopLevelHelp(config: CliConfig): string {
  return config.usage;
}

export interface FormatCommandHelpArgs {
  commandName: string;
  commandUsage: string;
}

export function formatCommandHelp(args: FormatCommandHelpArgs): string {
  return args.commandUsage;
}
