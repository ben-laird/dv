import type { Version } from "./version.ts";

// Stability is the regime a Package is in, determined by its Version
// (specs/language.md § Lexicon). `Unstable` (0.x.y) carries no stability
// contract; `Stable` (≥ 1.0.0) does. `classify` reads stability to decide
// whether breaking changes cap at minor (Unstable) or promote to major
// (Stable) — Algebra §2.

export type Stability = "Unstable" | "Stable";

export function stabilityOf(version: Version): Stability {
  return version.major === 0 ? "Unstable" : "Stable";
}
