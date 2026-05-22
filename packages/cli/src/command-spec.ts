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

// `reportError` is the only error-handling hook. It writes to stderr;
// the framework exits 1 afterward. Keeping it opaque lets callers layer
// in their own error machinery (structured codes, JSON envelopes) later
// without churning the framework.
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
  reportError?: (caughtError: unknown) => void;
}

export interface Cli {
  run(argv: string[]): Promise<number>;
}
