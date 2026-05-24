import { inheritedFlags } from "@seshat/cli";

// The dv-wide flags that every command surface accepts: `--json`,
// `--color`, `--no-color`. Declared once via the framework's
// `inheritedFlags()` helper (which is just a typed-identity capture)
// so each leaf's flag spec can spread them in without redeclaration
// drifting the per-flag kinds.
//
// "Inherited" here is a misnomer — no auto-merging happens. The
// helper captures the literal flag-map type so a leaf writing
// `flags: { ...sharedOutputFlags, foo: {...} }` gets the correct
// FlagsOf narrowing for `flags.json`, `flags.color`, etc.

export const sharedOutputFlags = inheritedFlags({
  json: { kind: "boolean", description: "Emit JSON envelope output" },
  color: { kind: "boolean", description: "Force color output" },
  "no-color": { kind: "boolean", description: "Disable color output" },
});

export interface ResolveColorEnabledArgs {
  forceColor: boolean;
  suppressColor: boolean;
  emitJson: boolean;
}

// Same logic dv's main.ts uses today; pulled into the router subdir
// so leaves don't have to import from main.ts. JSON mode forces
// colors off (escapes corrupt downstream parsers); explicit
// --no-color or NO_COLOR wins over --color; otherwise honor TTY
// detection.
export function resolveColorEnabled(args: ResolveColorEnabledArgs): boolean {
  if (args.emitJson) return false;
  if (args.suppressColor) return false;
  if (args.forceColor) return true;
  if (Deno.env.get("NO_COLOR")) return false;
  return Deno.stdout.isTerminal();
}
