// dv entry point. The whole CLI is one router tree (see
// ./cli/router/root.ts); this file is the binary boundary: it
// resolves the output mode from the raw argv and hands off to the
// framework. No subcommand dispatch lives here.

import { defineCli } from "@dv-cli/clipc";
import type { DvCtx } from "./cli/router/ctx.ts";
import { dvRoot } from "./cli/router/root.ts";
import { DV_VERSION } from "./dv-version.ts";

// Pre-scan the binary argv for output-mode signals (--json,
// --color, --no-color, $NO_COLOR). The framework can't know which
// leaf's `--json` flag is authoritative for a given run; dv
// answers that at the boundary instead — a literal `--json`
// anywhere in argv flips the mode for both stdout (per-leaf
// responsibility) and error rendering (framework responsibility).
//
// False positives (e.g. `dv add --message "--json"`) are tolerable:
// dv add doesn't accept --json so the value can't legitimately
// appear there.
function resolveOutputMode(argv: string[]): {
  emitJson: boolean;
  colorEnabled: boolean;
} {
  const emitJson = argv.includes("--json");
  const forceColor = argv.includes("--color");
  const suppressColor =
    argv.includes("--no-color") || Deno.env.get("NO_COLOR") !== undefined;
  // Precedence: json mode forces color off (escapes corrupt
  // parsers); explicit --no-color / NO_COLOR wins over --color;
  // --color wins over TTY detection; TTY detection is the default.
  // Errors render to stderr so the TTY check uses stderr.
  const colorEnabled = emitJson
    ? false
    : suppressColor
      ? false
      : forceColor
        ? true
        : Deno.stderr.isTerminal();
  return { emitJson, colorEnabled };
}

// Same boundary-level scan as resolveOutputMode: tool-wide
// `--debug` is a property of *the dv invocation*, not any one
// leaf, so we recognise it once here and let leaves consult
// `ctx.debugEnabled` rather than every leaf flag-checking
// independently. False positives (a `dv add --message "--debug"`)
// are tolerable for the same reason — no leaf that accepts
// arbitrary string content also accepts `--debug` as a
// behaviour flag.
function isDebugEnabled(argv: string[]): boolean {
  return argv.includes("--debug");
}

/**
 * Runs the `dv` CLI against a raw argv array and resolves to the process
 * exit code. This is the binary boundary: it pre-scans argv for the
 * tool-wide `--debug` and output-mode signals (`--json`, `--color`,
 * `--no-color`, `$NO_COLOR`), builds the {@link DvCtx} context, and hands
 * the whole router tree to the clipc framework for dispatch. It does not
 * itself perform subcommand routing — that lives in the router tree.
 *
 * Exported so the CLI can be driven programmatically (e.g. tests, or an
 * embedding process) without spawning a subprocess; the module's
 * `import.meta.main` guard calls it with `Deno.args` when run as a binary.
 *
 * @param argv - The raw argument vector, excluding the executable name
 *   (i.e. `Deno.args`-shaped).
 * @returns The process exit code: `0` on success, non-zero on failure
 *   (clipc maps unknown subcommands/flags to `2`).
 * @example
 * ```ts
 * import { main } from "@dv-cli/dv";
 * const code = await main(["status", "--json"]);
 * Deno.exit(code);
 * ```
 */
export function main(argv: string[]): Promise<number> {
  const debugEnabled = isDebugEnabled(argv);
  const cli = defineCli<DvCtx>({
    name: "dv",
    version: DV_VERSION,
    rootRouter: dvRoot,
    makeContext: () => ({ binaryArgv: argv, debugEnabled }),
    resolveOutputMode: ({ argv: incomingArgv }) =>
      resolveOutputMode(incomingArgv),
    humanErrorPrefix: "dv",
  });
  return cli.run(argv);
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
