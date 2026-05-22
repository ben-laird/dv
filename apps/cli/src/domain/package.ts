// A Package: a unit carrying an independent Version, managed by exactly
// one Plugin (specs/language.md § Lexicon).

export interface Package {
  name: string;
  path: string;
  plugin: string;
}
