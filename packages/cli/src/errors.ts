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

// The minimum any CliError shape must declare — a `code` string. The
// framework's generic accepts any shape extending this, so consumers
// can pin a discriminated union like:
//
//   type DvErrorShape =
//     | { code: "dirty-tree" }
//     | { code: "plugin-not-executable"; context: { pluginPath: string; opName: string } }
//     | { code: "release-partial-failure"; context: { totalAttempted: number } };
//
// then `class DvError extends CliError<DvErrorShape> {}` welds the
// code list to its per-code context. TS narrows `err.context` based
// on `err.code` natively at every read site — no separate map to
// keep in sync.
export interface CliErrorShape {
  code: string;
  context?: Record<string, unknown>;
}

// The default — unconstrained code, open-ended optional context.
// Keeps existing throw sites working without a generic argument and
// lets the framework operate on heterogeneous error trees (e.g. when
// rendering subErrors that come from multiple subclasses).
export type DefaultCliErrorShape = {
  code: string;
  context?: Record<string, unknown>;
};

// Pulls the runtime `context` type out of a shape variant. Three
// cases distribute across the union:
//   - variant has `context: X` (required) → context type is X
//   - variant has `context?: X` (optional) → context type is X
//     (we strip `undefined`)
//   - variant declares no `context` → context type is the empty
//     `Record<string, never>`
// The all-or-nothing matching at the constructor-init level is
// handled separately by `CliErrorInit`'s intersection below.
type ContextOf<TShape extends CliErrorShape> = TShape extends {
  context?: infer X;
}
  ? Exclude<X, undefined> extends never
    ? Record<string, never>
    : Exclude<X, undefined>
  : Record<string, never>;

// Constructor init payload, narrowed per discriminated-union arm.
// `code` accepts only the literal codes from the union; the
// `context` requirement follows the matched arm — required when the
// arm has `context: X`, optional when `context?: X`, forbidden (or
// `{}`-shaped) when the arm declares none. Default shape's
// `context?` is optional, keeping minimal constructions ergonomic.
export type CliErrorInit<
  TShape extends CliErrorShape = DefaultCliErrorShape,
> = TShape extends CliErrorShape
  ? {
      code: TShape["code"];
      message: string;
      hint?: string;
      severity?: "error" | "warning";
      cause?: unknown;
      subErrors?: CliError[];
    } & (TShape extends { context: infer X }
      ? { context: X }
      : TShape extends { context?: infer X }
        ? { context?: Exclude<X, undefined> }
        : { context?: Record<string, never> })
  : never;

// The JSON-envelope shape a CliError serializes to (minus the
// top-level `schema` field, which the envelope wrapper adds). Erased
// to `string` / `Record<string, unknown>` at the wire boundary —
// consumers parsing JSON back to typed errors can re-narrow against
// their own union.
export interface CliErrorPayload {
  code: string;
  message: string;
  hint?: string;
  severity?: "error" | "warning";
  subErrors?: CliErrorPayload[];
  context?: Record<string, unknown>;
}

export class CliError<
  TShape extends CliErrorShape = DefaultCliErrorShape,
> extends Error {
  readonly code: TShape["code"];
  readonly hint?: string;
  readonly severity: "error" | "warning";
  // subErrors carry their own (typically different) shape; erased to
  // the default at the array boundary so the parent doesn't have to
  // declare them.
  readonly subErrors: CliError[];
  readonly context: ContextOf<TShape>;

  constructor(init: CliErrorInit<TShape>) {
    super(
      init.message,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = "CliError";
    this.code = init.code as TShape["code"];
    this.hint = init.hint;
    this.severity = init.severity ?? "error";
    this.subErrors = init.subErrors ?? [];
    this.context = (("context" in init ? init.context : {}) ??
      {}) as ContextOf<TShape>;
  }

  // Serializes the error tree to the JSON-envelope payload shape.
  // Omits default `severity` and empty `subErrors` / `context` so the
  // wire format stays terse. Recursive — sub-errors serialize
  // themselves. The context erases to `Record<string, unknown>` here;
  // typed re-narrowing happens at the read site against the
  // consumer's own union.
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
    const contextRecord = this.context as Record<string, unknown>;
    if (Object.keys(contextRecord).length > 0) {
      payload.context = contextRecord;
    }
    return payload;
  }
}
