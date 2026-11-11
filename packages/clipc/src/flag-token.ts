/**
 * Whether `token` is written as a switch: it starts with `-` and is more than
 * `-`. A lone `-` is an ordinary word by Unix convention (it often names
 * stdin), so it is never a flag. The parser and the router's subcommand scan
 * both ask this, so the rule cannot drift between them.
 */
export function isFlagToken(token: string): boolean {
  return token.startsWith("-") && token !== "-";
}
