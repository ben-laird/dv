// Public surface of the @dv-cli/clipc router-based API. Re-exported
// from the package's top-level mod.ts; consumers shouldn't import
// from `./router/*.ts` directly (those paths aren't stable).

export {
  type CommandNode,
  type CommandRequest,
  type CommandSpec,
  command,
} from "./command.ts";
export {
  type Cli,
  type DefineCliConfig,
  type OutputMode,
  type OutputModeContext,
  type ResolveOutputMode,
  defineCli,
} from "./define-cli.ts";
export {
  formatCommandHelp,
  formatRouterHelp,
} from "./help.ts";
export {
  type CtxBoundBuilders,
  type DefaultDispatch,
  type RouterChild,
  type RouterNode,
  type RouterSpec,
  forCtx,
  inheritedFlags,
  router,
} from "./router.ts";
export {
  type CliHandler,
  type CliRequest,
  type CliResponse,
  type DoneStep,
  type NextStep,
  type Step,
  done,
  next,
} from "./types.ts";
