// Public types for command-spec authoring. The framework consumes
// `CliConfig` (passed to defineCli) and produces a `Cli` that runs an
// argv. Runners receive a `RunnerContext<TFlagMap>` — the typed parsed
// flags plus the positional trailing argv after parseArgs stripped the
// flagged tokens.
//
// The flag spec is intentionally per-flag (object-of-objects) rather
// than parseArgs' string-array soup so each flag's kind and alias
// travel together. The framework lowers it to parseArgs' shape
// internally.

export type FlagSpec =
  | { kind: "boolean"; alias?: string; description?: string }
  | { kind: "string"; alias?: string; description?: string }
  | { kind: "collect"; alias?: string; description?: string };

export type FlagsOf<TFlagMap extends Record<string, FlagSpec>> = {
  [Key in keyof TFlagMap]: TFlagMap[Key]["kind"] extends "boolean"
    ? boolean | undefined
    : TFlagMap[Key]["kind"] extends "string"
      ? string | undefined
      : string[] | undefined;
};

export interface RunnerContext<TFlagMap extends Record<string, FlagSpec>> {
  flags: FlagsOf<TFlagMap>;
  argv: string[];
}

export type CommandRunner<TFlagMap extends Record<string, FlagSpec>> = (
  ctx: RunnerContext<TFlagMap>,
) => number | Promise<number>;

export interface CommandSpec<
  TFlagMap extends Record<string, FlagSpec> = Record<string, FlagSpec>,
> {
  flags: TFlagMap;
  usage: string;
  run: CommandRunner<TFlagMap>;
}

// `reportError` is the framework's structured error hook. It receives
// any value the runner threw (CliError, plain Error, or anything else
// the runner managed to throw); the framework wraps non-CliError
// values into a default-shape CliError before invoking the hook, so
// implementations can assume a uniform `caughtError instanceof
// CliError` if they choose. The `ctx.mode` field tells the hook
// whether to render to human stderr or to the --json envelope; the
// caller (e.g. dv's main.ts) decides mode based on its own flag
// parsing. The framework exits 1 after the hook returns.
export interface ReportErrorContext {
  mode: "human" | "json";
}

export type ReportErrorHook = (
  caughtError: unknown,
  ctx: ReportErrorContext,
) => void;

export interface CliConfig {
  name: string;
  version: string;
  usage: string;
  // Per-command flag maps are heterogeneous — each command's flag
  // types are unrelated, so a homogeneous generic on the map would
  // force every command into the same shape. `any` is the honest pinch
  // here; the per-command CommandSpec generics still type the runner.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  // deno-lint-ignore no-explicit-any
  commands: Record<string, CommandSpec<any>>;
  reportError?: ReportErrorHook;
}

export interface Cli {
  run(argv: string[]): Promise<number>;
}

// Identity helper that captures the literal FlagSpec map type. Without
// this, callers writing `const x: CommandSpec = { flags: {...}, ... }`
// land on the default generic (Record<string, FlagSpec>), which widens
// FlagsOf to the union of every kind's payload and breaks the runner's
// flag typing. `defineCommand({...})` lets TS infer TFlagMap from the
// literal so flags inside the runner carry their exact kind shapes.
export function defineCommand<TFlagMap extends Record<string, FlagSpec>>(
  spec: CommandSpec<TFlagMap>,
): CommandSpec<TFlagMap> {
  return spec;
}
