// CliError is the framework's structured error class. CLIs using
// @seshat/cli throw subclasses (e.g. dv's DvError) so the framework
// can render them uniformly to either human stderr (renderCliError
// human mode) or a JSON envelope (--json mode). The shape is the
// public contract; the rendering is the framework's concern.
//
// Why structured: errors carry context. A bare `dv: ...` line tells
// the user something went wrong but not how to recover, or what
// happened underneath. The fields below let the writer surface the
// stable code (for machine consumers), the human message, an optional
// remediation hint, the source error chain, sub-errors for
// aggregations like `dv release --partial-failure`, and arbitrary
// context for things like the offending plugin path or package name.

export interface CliErrorInit {
  // Stable identifier — the part downstream tooling and tests pin
  // against. Per `specs/v1-scope.md` § Automation surface, codes are
  // part of dv's public contract.
  code: string;
  message: string;
  // Optional remediation suggestion. Rendered as a dim "hint:" line
  // under the main message.
  hint?: string;
  // Severity is reserved for future warning-level diagnostics; default
  // 'error'. Unused today but on the wire so we don't have to migrate
  // when warning support arrives.
  severity?: "error" | "warning";
  // Standard Error.cause; preserved through the chain but not
  // serialized into the JSON envelope (it's a JS Error instance, not
  // a contract). Future --debug rendering will surface it.
  cause?: unknown;
  // For aggregations — e.g. dv release reporting one CliError per
  // package that failed to publish, wrapped under a parent
  // CliError('release-partial-failure'). Renders recursively.
  subErrors?: CliError[];
  // Open-ended structured data for the JSON envelope. Use this for
  // anything callers should be able to branch on: plugin paths,
  // package names, file paths, tag strings. Keep values JSON-
  // serializable.
  context?: Record<string, unknown>;
}

// The JSON-envelope shape a CliError serializes to (minus the
// top-level `schema` field, which the envelope wrapper adds). Used by
// `toJSON` and matched by the Zod schema in cli-error-schema.ts.
export interface CliErrorPayload {
  code: string;
  message: string;
  hint?: string;
  severity?: "error" | "warning";
  subErrors?: CliErrorPayload[];
  context?: Record<string, unknown>;
}

export class CliError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly severity: "error" | "warning";
  readonly subErrors: CliError[];
  readonly context: Record<string, unknown>;

  constructor(init: CliErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "CliError";
    this.code = init.code;
    this.hint = init.hint;
    this.severity = init.severity ?? "error";
    this.subErrors = init.subErrors ?? [];
    this.context = init.context ?? {};
  }

  // Serializes the error tree to the JSON-envelope payload shape.
  // Omits default `severity` and empty `subErrors` / `context` so the
  // wire format stays terse. Recursive — sub-errors serialize
  // themselves.
  toJSON(): CliErrorPayload {
    const payload: CliErrorPayload = {
      code: this.code,
      message: this.message,
    };
    if (this.hint !== undefined) payload.hint = this.hint;
    if (this.severity !== "error") payload.severity = this.severity;
    if (this.subErrors.length > 0) {
      payload.subErrors = this.subErrors.map((subError) => subError.toJSON());
    }
    if (Object.keys(this.context).length > 0) {
      payload.context = this.context;
    }
    return payload;
  }
}
