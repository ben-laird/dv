/**
 * Whether `argv` asks for help: a `--help` or `-h` token before any `--`.
 * Everything after `--` is a positional word, never a switch, so
 * `mycli add -- --help` hands `--help` to the leaf instead of printing help.
 * Every node that intercepts help asks this, so the rule cannot drift
 * between routers and leaves.
 */
export function requestsHelp(argv: readonly string[]): boolean {
  for (const token of argv) {
    if (token === "--") return false;
    if (token === "--help" || token === "-h") return true;
  }
  return false;
}
