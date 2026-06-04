/**
 * Public surface of the `@dv-cli/clipc` router-based API: the builders
 * (`command`, `router`, `defineCli`, `forCtx`, `inheritedFlags`), the
 * trampoline step constructors (`done`, `next`), the help renderers, and
 * the types that describe the router/command/leaf model. Re-exported from
 * the package's top-level `mod.ts`; consumers shouldn't import from
 * `./router/*.ts` directly (those paths aren't stable).
 *
 * @module
 */

export {
  type CommandNode,
  type CommandRequest,
  type CommandSpec,
  command,
} from "./command.ts";
export {
  type Cli,
  type DefineCliConfig,
  defineCli,
  type OutputMode,
  type OutputModeContext,
  type ResolveOutputMode,
} from "./define-cli.ts";
export {
  type FormatCommandHelpArgs,
  type FormatRouterHelpArgs,
  formatCommandHelp,
  formatRouterHelp,
} from "./help.ts";
export {
  type CtxBoundBuilders,
  type DefaultDispatch,
  forCtx,
  inheritedFlags,
  type RouterChild,
  type RouterNode,
  type RouterSpec,
  router,
} from "./router.ts";
export {
  type CliHandler,
  type CliRequest,
  type CliResponse,
  type DoneStep,
  done,
  type NextOptions,
  type NextStep,
  next,
  type Step,
} from "./types.ts";
