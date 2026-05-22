// Structured error types. The `code` is the stable identifier surfaced in
// `--json` output (specs/v1-scope.md § Automation surface).

export class DvError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DvError";
  }
}

export class ConfigError extends DvError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ConfigError";
  }
}

export class PluginError extends DvError {
  constructor(
    code: string,
    message: string,
    public readonly plugin: string,
    public readonly op: string,
  ) {
    super(code, message);
    this.name = "PluginError";
  }
}
