import type { CommandNode } from "./command.ts";
import type { RouterChild, RouterNode } from "./router.ts";

// Auto-generated help text. Walks the router's children to produce
// a `Usage:` line and a sorted subcommand list with descriptions.
// Compared to a hand-maintained USAGE_TEXT string, this can't drift
// — adding a new child updates the help output automatically.
//
// Two layouts:
//   - Router help: shows the subcommand list
//   - (Command help is rendered separately by the framework via the
//     command's own flag spec; routers don't reach into leaves'
//     flag descriptions.)
//
// Color support is opt-in via the `colorEnabled` arg. When on, the
// subcommand name is bolded and the description is dimmed so the
// scannable column (the names) stands out. The framework decides
// whether to enable color from its OutputMode resolver — same
// signal that gates colored error output.

const ANSI_BOLD_OPEN = "\x1b[1m";
const ANSI_BOLD_CLOSE = "\x1b[22m";
const ANSI_DIM_OPEN = "\x1b[2m";
const ANSI_DIM_CLOSE = "\x1b[22m";

function bold(text: string, colorEnabled: boolean): string {
  return colorEnabled ? `${ANSI_BOLD_OPEN}${text}${ANSI_BOLD_CLOSE}` : text;
}

function dim(text: string, colorEnabled: boolean): string {
  // Skip wrapping empty strings so the rendered output doesn't
  // pick up phantom `^[[2m^[[22m` pairs that render as nothing
  // visible but clutter terminal-recorder output (asciinema etc).
  if (!colorEnabled || text.length === 0) return text;
  return `${ANSI_DIM_OPEN}${text}${ANSI_DIM_CLOSE}`;
}

export interface FormatRouterHelpArgs<Ctx> {
  path: string[];
  children: Record<string, RouterChild<Ctx>>;
  colorEnabled?: boolean;
}

export function formatRouterHelp<Ctx>(args: FormatRouterHelpArgs<Ctx>): string {
  const breadcrumb = args.path.join(" ");
  const colorEnabled = args.colorEnabled ?? false;
  const sortedChildEntries = Object.entries(args.children).sort(
    ([leftName], [rightName]) => leftName.localeCompare(rightName),
  );
  const widestName = sortedChildEntries.reduce(
    (widest, [name]) => Math.max(widest, name.length),
    0,
  );
  // Continuation lines for sub-router previews indent to where the
  // description column starts, so a reader's eye follows from the
  // parent description down to its inline child list.
  const continuationIndent = " ".repeat(2 + widestName + 2);

  const lines: string[] = [];
  lines.push(`Usage: ${breadcrumb} <subcommand> [...]`);
  lines.push("");
  lines.push("Subcommands:");
  for (const [childName, childNode] of sortedChildEntries) {
    const description = describeChild(childNode);
    // Pad the raw (uncolored) name to width, then wrap in ANSI so
    // the visible column widths line up regardless of color mode —
    // ANSI escapes are zero-width to the terminal but count toward
    // string.length, so padEnd has to happen before the wrap.
    const paddedName = childName.padEnd(widestName + 2);
    lines.push(
      `  ${bold(paddedName, colorEnabled)}${dim(description, colorEnabled)}`,
    );
    // For sub-routers, preview the grandchildren on a continuation
    // line so `dv --help` shows what's inside `dv plugin` /
    // `dv migrate` without making the reader drill down. Leaves
    // get no continuation (their flags live in `<name> --help`).
    //
    // The `↳ ` prefix + bolded child names signal "these are
    // subcommands you can type" two ways — the arrow gives depth
    // and the bolding matches how parent command names look in
    // the main list. Two-space separator between names so each
    // command stands as its own scannable token rather than
    // running together as a comma-list (which the reader could
    // mistake for prose).
    if (childNode.kind === "router") {
      const grandchildNames = Object.keys(childNode.children).sort(
        (left, right) => left.localeCompare(right),
      );
      if (grandchildNames.length > 0) {
        const arrow = bold("↳", colorEnabled);
        const renderedNames = grandchildNames
          .map((name) => bold(name, colorEnabled))
          .join("  ");
        lines.push(`${continuationIndent}${arrow} ${renderedNames}`);
      }
    }
  }
  lines.push("");
  lines.push(`Run \`${breadcrumb} <subcommand> --help\` for per-command flags.`);
  return lines.join("\n");
}

function describeChild<Ctx>(child: RouterChild<Ctx>): string {
  if (child.kind === "router") return child.description ?? "(sub-router)";
  return child.description ?? "";
}

// Command help is rendered by the framework when a leaf is invoked
// with `--help` / `-h`. The leaf's handler intercepts those tokens
// before parseSubcommandArgv would; this helper produces the text.
export interface FormatCommandHelpArgs {
  path: string[];
  description?: string;
  flags: Record<string, { kind: string; description?: string; alias?: string }>;
  colorEnabled?: boolean;
}

export function formatCommandHelp(args: FormatCommandHelpArgs): string {
  const breadcrumb = args.path.join(" ");
  const colorEnabled = args.colorEnabled ?? false;
  const lines: string[] = [];
  lines.push(`Usage: ${breadcrumb} [flags] [args...]`);
  if (args.description !== undefined) {
    lines.push("");
    lines.push(args.description);
  }
  const flagEntries = Object.entries(args.flags);
  if (flagEntries.length === 0) {
    lines.push("");
    lines.push("(no flags declared)");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("Flags:");
  // Compute label width on the uncolored text (ANSI escapes count
  // toward string.length but render zero-width).
  const labelWidth = flagEntries.reduce((widest, [flagName, flagSpec]) => {
    const kindMarker = flagSpec.kind === "boolean" ? "" : ` <${flagSpec.kind}>`;
    return Math.max(widest, `--${flagName}${kindMarker}`.length);
  }, 0);
  for (const [flagName, flagSpec] of flagEntries.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const aliasSuffix =
      flagSpec.alias !== undefined ? `  (-${flagSpec.alias})` : "";
    const kindMarker = flagSpec.kind === "boolean" ? "" : ` <${flagSpec.kind}>`;
    const labelText = `--${flagName}${kindMarker}`;
    const paddedLabel = labelText.padEnd(labelWidth + 4);
    lines.push(
      `  ${bold(paddedLabel, colorEnabled)}${dim(flagSpec.description ?? "", colorEnabled)}${dim(aliasSuffix, colorEnabled)}`,
    );
  }
  return lines.join("\n");
}

// Re-export so consumers can pull RouterNode types via the help
// module if they prefer (some tree-walking utilities live here).
export type { CommandNode, RouterNode };
