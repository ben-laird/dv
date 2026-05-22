import type { Cli, CliConfig, CommandSpec } from "./command-spec.ts";
import { CliError } from "./errors.ts";
import { formatCommandHelp, formatTopLevelHelp } from "./help.ts";
import {
  parseSubcommandArgv,
  UnknownFlagError,
} from "./parse-subcommand.ts";

// defineCli is the framework's single entry point. It takes a CliConfig
// (name, version, usage, commands, optional reportError hook) and
// returns a Cli with `.run(argv)`. The binary calls
// `Deno.exit(await cli.run(Deno.args))`.
//
// Dispatch rules:
//   - empty argv or top-level --help/-h → top-level help, exit 0
//   - --version / -V (top-level only) → print version, exit 0
//   - unknown subcommand → "unknown command 'X'" on stderr, exit 2
//   - per-command --help / -h (anywhere in the subcommand argv) →
//     that command's usage, exit 0
//   - unknown flag for a subcommand → "unknown flag '--foo'" on
//     stderr, exit 2
//   - runner throws → reportError(err) if provided, exit 1
//
// --help/-h is injected per command; callers do NOT declare it in
// their flag spec. Top-level help/version only fire when their token
// is the first argv element.

const TOP_LEVEL_HELP_TOKENS = new Set(["--help", "-h"]);
const TOP_LEVEL_VERSION_TOKENS = new Set(["--version", "-V"]);
const COMMAND_HELP_TOKENS = new Set(["--help", "-h"]);

export function defineCli(config: CliConfig): Cli {
  return {
    async run(argv: string[]): Promise<number> {
      const firstToken = argv[0];

      if (firstToken === undefined || TOP_LEVEL_HELP_TOKENS.has(firstToken)) {
        console.log(formatTopLevelHelp(config));
        return 0;
      }
      if (TOP_LEVEL_VERSION_TOKENS.has(firstToken)) {
        console.log(config.version);
        return 0;
      }

      const matchedCommand: CommandSpec | undefined = config.commands[firstToken];
      if (matchedCommand === undefined) {
        console.error(`${config.name}: unknown command '${firstToken}'`);
        console.error(`run '${config.name} --help' for usage`);
        return 2;
      }

      const subcommandArgv = argv.slice(1);
      if (subcommandArgv.some((token) => COMMAND_HELP_TOKENS.has(token))) {
        console.log(
          formatCommandHelp({
            commandName: firstToken,
            commandUsage: matchedCommand.usage,
          }),
        );
        return 0;
      }

      let parsedContext: ReturnType<typeof parseSubcommandArgv>;
      try {
        parsedContext = parseSubcommandArgv({
          flagSpecMap: matchedCommand.flags,
          subcommandArgv,
        });
      } catch (caughtError) {
        if (caughtError instanceof UnknownFlagError) {
          console.error(
            `${config.name} ${firstToken}: unknown flag '${caughtError.flagToken}'`,
          );
          console.error(
            `run '${config.name} ${firstToken} --help' for usage`,
          );
          return 2;
        }
        throw caughtError;
      }

      try {
        return await matchedCommand.run(parsedContext);
      } catch (caughtError) {
        if (config.reportError !== undefined) {
          // Wrap non-CliError throws so the reporter always sees a
          // uniform shape. Mode defaults to "human" here; callers
          // that want JSON output read the mode from their own flag
          // closure inside the reporter implementation (the
          // framework can't know which command's `--json` flag is
          // the relevant one). EC7 wires the per-command flow.
          const errorForReport =
            caughtError instanceof CliError
              ? caughtError
              : new CliError({
                  code: "unknown",
                  message:
                    caughtError instanceof Error
                      ? caughtError.message
                      : String(caughtError),
                  cause: caughtError,
                });
          config.reportError(errorForReport, { mode: "human" });
        }
        return 1;
      }
    },
  };
}
