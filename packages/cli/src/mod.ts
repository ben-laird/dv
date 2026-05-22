// Public surface of @seshat/cli — a minimal argv-dispatch CLI
// framework. Tiny on purpose: register subcommands with typed flag
// specs, get a `Cli` that routes argv. Errors go through CliError +
// renderCliError so human-stderr and --json envelope outputs flow
// from one structured shape.

export {
  type RawCliErrorEnvelope,
  type RawCliErrorPayload,
  rawCliErrorEnvelopeSchema,
  rawCliErrorPayloadSchema,
} from "./cli-error-schema.ts";
export { defineCommand } from "./command-spec.ts";
export type {
  Cli,
  CliConfig,
  CommandRunner,
  CommandSpec,
  FlagSpec,
  FlagsOf,
  ReportErrorContext,
  ReportErrorHook,
  RunnerContext,
} from "./command-spec.ts";
export { defineCli } from "./define-cli.ts";
export {
  CliError,
  type CliErrorInit,
  type CliErrorPayload,
  type CliErrorShape,
  type DefaultCliErrorShape,
} from "./errors.ts";
export { type RenderCliErrorArgs, renderCliError } from "./render-cli-error.ts";
