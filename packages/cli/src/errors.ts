// CliError is the framework's structured error class. CLIs using
// @seshat/cli throw subclasses (e.g. dv's DvError) so the framework
// can render them uniformly to either human stderr (renderCliError
// human mode) or a JSON envelope (--json mode). The shape is the
// public contract; the rendering is the framework's concern.
//
// The error's identity lives in a single `kind: TShape` field, where
// TShape is a discriminated union the consumer declares (see
// @seshat/dv's DvErrorShape). That single field is what makes
// catch-site narrowing work cleanly: `if (err.kind.code === "x")`
// narrows `err.kind.context` along with it, the way Rust's `enum`
// variants do. Sibling fields like `message`, `hint`, `subErrors`,
// `severity`, and `cause` are envelope concerns and live on the
// class itself.

// The minimum any CliError shape must declare — a `code` string.
// Consumers pin a discriminated union extending this:
//
//   type DvErrorShape =
//     | { code: "dirty-tree" }
//     | { code: "plugin-not-executable"; context: { pluginPath: string; opName: string } }
//     | { code: "release-partial-failure"; context: { totalAttempted: number } };
//
// then `class DvError extends CliError<DvErrorShape> {}` welds the
// code list to its per-code context. At every read site,
// `if (err.kind.code === "plugin-not-executable") err.kind.context.pluginPath`
// narrows automatically — no casts, no helper guards.
export interface CliErrorShape {
  code: string;
  context?: Record<string, unknown>;
}

// The default — unconstrained code, open-ended optional context.
// Keeps existing throw sites working without a generic argument and
// lets the framework operate on heterogeneous error trees (e.g.
// rendering subErrors that come from multiple subclasses).
export type DefaultCliErrorShape = {
  code: string;
  context?: Record<string, unknown>;
};

// Constructor init payload. Flattens TShape's fields onto the init
// object so authors write `{ code, context, message, ... }` rather
// than `{ kind: { code, context }, message, ... }` — the class itself
// nests them. Narrowed per discriminated-union arm: `code` accepts
// only the union's literal codes, `context` follows the matched arm.
//
// `exitCode` is optional and lives on the error itself because the
// right exit code is a property of *what failed*, not of how the
// failure is transported. Specific codes warrant specific codes
// (`unknown-flag` should always be 2, `dirty-tree` always 1); the
// framework's response renderer reads it directly. Omit to default
// to 1 at render time.
export type CliErrorInit<
  TShape extends CliErrorShape = DefaultCliErrorShape,
> = TShape extends CliErrorShape
  ? {
      code: TShape["code"];
      message: string;
      hint?: string;
      severity?: "error" | "warning";
      exitCode?: number;
      cause?: unknown;
      subErrors?: CliError[];
    } & (TShape extends { context: infer X }
      ? { context: X }
      : TShape extends { context?: infer X }
        ? { context?: Exclude<X, undefined> }
        : { context?: Record<string, never> })
  : never;

// The JSON-envelope shape a CliError serializes to (minus the
// top-level `schema` field, which the envelope wrapper adds).
// Intentionally flat — wire consumers see `{ code, context }` at
// the top level, not `{ kind: { code, context } }`. The `kind`
// nesting is a TS-narrowing convenience; the wire keeps the shape
// callers already pin against.
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
  // The discriminator field. Narrowing `err.kind.code` propagates to
  // `err.kind.context` because they're parts of one tagged-union
  // value, not separate readonly fields. This is the whole reason
  // for the nesting.
  readonly kind: TShape;
  readonly hint?: string;
  readonly severity: "error" | "warning";
  // The right exit code is a property of what failed, not of how
  // it's transported. Optional; framework defaults to 1 when omitted.
  readonly exitCode?: number;
  // subErrors carry their own (typically different) shape; erased to
  // the default at the array boundary so the parent doesn't have to
  // declare them.
  readonly subErrors: CliError[];

  constructor(init: CliErrorInit<TShape>) {
    super(
      init.message,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = "CliError";
    // Reconstruct the tagged-union value from the flat init. The
    // intersection types make TS treat `init.context` as required-
    // when-the-arm-demands-it, optional-otherwise; the runtime
    // collapses both into the kind object.
    const contextValue = "context" in init ? init.context : undefined;
    this.kind = (contextValue !== undefined
      ? { code: init.code, context: contextValue }
      : { code: init.code }) as TShape;
    this.hint = init.hint;
    this.severity = init.severity ?? "error";
    this.exitCode = init.exitCode;
    this.subErrors = init.subErrors ?? [];
  }

  // Serializes the error tree to the JSON-envelope payload shape.
  // Flattens `kind` back onto the wire — consumers see `code` and
  // `context` at the top level, the same shape they used to write
  // against before the kind-nesting refactor. Omits default
  // `severity` and empty `subErrors` / `context` so the format
  // stays terse. Recursive — sub-errors serialize themselves.
  toJSON(): CliErrorPayload {
    const payload: CliErrorPayload = {
      code: this.kind.code,
      message: this.message,
    };
    if (this.hint !== undefined) payload.hint = this.hint;
    if (this.severity !== "error") payload.severity = this.severity;
    if (this.subErrors.length > 0) {
      payload.subErrors = this.subErrors.map((subError) => subError.toJSON());
    }
    const contextRecord = (this.kind as { context?: Record<string, unknown> })
      .context;
    if (contextRecord !== undefined && Object.keys(contextRecord).length > 0) {
      payload.context = contextRecord;
    }
    return payload;
  }
}
