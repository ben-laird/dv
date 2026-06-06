// Public surface of @dv-cli/clipc. The framework is a router-based,
// trampoline-dispatched CLI builder: define a tree of `command()`
// leaves and `router()` nodes, hand the root to `defineCli`, and the
// framework owns argv parsing, dispatch, help generation, and error
// rendering. See `./router/` for the implementation.
//
// Error envelopes use CliError + renderCliError for consistent
// human/JSON output. Consumers extend CliError with their own
// discriminated-union error shapes for typed catch-site narrowing.

export {
  type CliErrorEnvelopeParseIssue,
  type CliErrorEnvelopeParseResult,
  parseCliErrorEnvelope,
  type RawCliErrorEnvelope,
  type RawCliErrorPayload,
  safeParseCliErrorEnvelope,
} from "./cli-error-schema.ts";
export {
  CliError,
  type CliErrorInit,
  type CliErrorPayload,
  type CliErrorShape,
  type DefaultCliErrorShape,
} from "./errors.ts";
export {
  type FlagSpec,
  type FlagsOf,
  type LoweredFlagSpec,
  lowerFlagSpec,
} from "./flag-spec.ts";
export { type RenderCliErrorArgs, renderCliError } from "./render-cli-error.ts";

// Router framework — the main surface consumers build CLIs against.
export {
  type Cli,
  type CliHandler,
  type CliRequest,
  type CliResponse,
  type CommandNode,
  type CommandRequest,
  type CommandSpec,
  type CtxBoundBuilders,
  command,
  type DefaultDispatch,
  type DefineCliConfig,
  type DoneStep,
  defineCli,
  done,
  type FormatCommandHelpArgs,
  type FormatRouterHelpArgs,
  forCtx,
  formatCommandHelp,
  formatRouterHelp,
  inheritedFlags,
  type NextOptions,
  type NextStep,
  next,
  type OutputMode,
  type OutputModeContext,
  type ResolveOutputMode,
  type RouterChild,
  type RouterNode,
  type RouterSpec,
  router,
  type Step,
} from "./router/mod.ts";
