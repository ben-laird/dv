// A Package: a unit carrying an independent Version, managed by exactly
// one Plugin (specs/language.md § Lexicon).
//
// `plugin` is the canonical `pluginReferenceKey` of the assignment
// that claimed this Package — e.g. "path:./scripts/my-plugin",
// "builtin:cargo", "command:my-plugin", "run:deno run -A ...".
// Callers use it as a lookup
// into the Map<string, ResolvedPlugin> a single command-run builds
// once and shares across phases. The actual reference object lives
// on the PluginAssignment in the config.

export interface Package {
  name: string;
  path: string;
  plugin: string;
}
