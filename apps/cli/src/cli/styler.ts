// Shared ANSI styler for dv's human-mode renderers. One source of truth
// for the palette so status/version/release stay visually consistent —
// pre-extraction each command carried its own copy with subtly different
// helpers, and adding any new color meant editing all three.
//
// Philosophy (audit decision): subtle tone. The bulk of each line stays
// neutral; color is reserved for anchors the eye scans for (✓/✗,
// bump-type label, "first stable" marker, hint lines). This holds up in
// both dark and light terminals — no row is filled-in with color.
//
// Every helper is a no-op when colorEnabled is false. The caller resolves
// that (NO_COLOR / --no-color / TTY detection / --json) at the binary
// boundary — `makeStyler(false)` returns the same shape as
// `makeStyler(true)` so the renderers don't have to branch.

export interface Styler {
  bold(text: string): string;
  dim(text: string): string;
  // cyan: code-y / clickable things — file paths, command names in
  // backticks. Carries "this is a thing you'd type or open" semantics.
  cyan(text: string): string;
  // green: success anchors — ✓ markers, completed-publish lines.
  green(text: string): string;
  // yellow: warnings + attention-needed states — unresolved-reference
  // section headings, "(first stable!)" celebration, awaiting-release
  // counts (a positive thing, but the user should look).
  yellow(text: string): string;
  // red: failure anchors — ✗ markers, the per-package release-op-failed
  // lines under release-partial-failure.
  red(text: string): string;
  // magenta: bump-type labels — patch / minor / major. The "what kind
  // of change is this" cell that benefits most from a glance.
  magenta(text: string): string;
}

const STYLERS = {
  bold: { open: "\x1b[1m", close: "\x1b[22m" },
  dim: { open: "\x1b[2m", close: "\x1b[22m" },
  cyan: { open: "\x1b[36m", close: "\x1b[39m" },
  green: { open: "\x1b[32m", close: "\x1b[39m" },
  yellow: { open: "\x1b[33m", close: "\x1b[39m" },
  red: { open: "\x1b[31m", close: "\x1b[39m" },
  magenta: { open: "\x1b[35m", close: "\x1b[39m" },
} as const;

export function makeStyler(colorEnabled: boolean): Styler {
  if (!colorEnabled) {
    return {
      bold: passthrough,
      dim: passthrough,
      cyan: passthrough,
      green: passthrough,
      yellow: passthrough,
      red: passthrough,
      magenta: passthrough,
    };
  }
  return {
    bold: (text) => wrap(text, STYLERS.bold),
    dim: (text) => wrap(text, STYLERS.dim),
    cyan: (text) => wrap(text, STYLERS.cyan),
    green: (text) => wrap(text, STYLERS.green),
    yellow: (text) => wrap(text, STYLERS.yellow),
    red: (text) => wrap(text, STYLERS.red),
    magenta: (text) => wrap(text, STYLERS.magenta),
  };
}

function passthrough(text: string): string {
  return text;
}

function wrap(
  text: string,
  escapeCodes: { open: string; close: string },
): string {
  return `${escapeCodes.open}${text}${escapeCodes.close}`;
}
