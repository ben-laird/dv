// CliError is the framework's structured error class. CLIs using
// @dv-cli/clipc throw subclasses (e.g. dv's DvError) so the framework
// can render them uniformly to either human stderr (renderCliError
// human mode) or a JSON envelope (--json mode). The shape is the
// public contract; the rendering is the framework's concern.
//
// The error's identity lives in a single `kind: TShape` field, where
// TShape is a discriminated union the consumer declares (see
// @dv-cli/dv's DvErrorShape). That single field is what makes
// catch-site narrowing work cleanly: `if (err.kind.code === "x")`
// narrows `err.kind.context` along with it, the way Rust's `enum`
// variants do. Sibling fields like `message`, `hint`, `subErrors`,
// `severity`, and `cause` are envelope concerns and live on the
// class itself.

/**
 * The minimum any {@link CliError} shape must declare — a `code` string with
 * optional structured `context`.
 *
 * Consumers pin a discriminated union extending this, then weld it to a
 * subclass so every code carries its own context type and catch-site
 * narrowing works without casts:
 *
 * @example
 * ```ts
 * type DvErrorShape =
 *   | { code: "dirty-tree" }
 *   | { code: "plugin-not-executable"; context: { pluginPath: string; opName: string } }
 *   | { code: "release-partial-failure"; context: { totalAttempted: number } };
 *
 * class DvError extends CliError<DvErrorShape> {}
 *
 * // At a read site, narrowing `kind.code` narrows `kind.context` too:
 * if (err.kind.code === "plugin-not-executable") err.kind.context.pluginPath;
 * ```
 */
export interface CliErrorShape {
  /** Stable error code that discriminates the shape's union arm. */
  code: string;
  /** Optional per-code structured context carried alongside the `code`. */
  context?: Record<string, unknown>;
}

/**
 * The default {@link CliErrorShape} — an unconstrained `code` and open-ended
 * optional `context`. Used when no generic argument is supplied, so existing
 * throw sites keep working and the framework can operate on heterogeneous
 * error trees (e.g. rendering `subErrors` drawn from multiple subclasses).
 */
export type DefaultCliErrorShape = {
  code: string;
  context?: Record<string, unknown>;
};

/**
 * Constructor init payload for {@link CliError}. Flattens `TShape`'s fields
 * onto the init object so authors write `{ code, context, message, ... }`
 * rather than `{ kind: { code, context }, message, ... }` — the class nests
 * them internally. The type narrows per discriminated-union arm: `code`
 * accepts only the union's literal codes, and `context` follows the matched
 * arm (required, optional, or absent).
 *
 * `exitCode` is optional and lives on the error because the right exit code is
 * a property of *what failed*, not of how the failure is transported; omit it
 * to default to 1 at render time.
 */
export type CliErrorInit<TShape extends CliErrorShape = DefaultCliErrorShape> =
  TShape extends CliErrorShape
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

/**
 * The JSON-envelope shape a {@link CliError} serializes to via `toJSON()`
 * (minus the top-level `schema` field, which the envelope wrapper adds).
 * Intentionally flat — wire consumers see `{ code, context }` at the top
 * level, not `{ kind: { code, context } }`. The `kind` nesting is an in-process
 * TS-narrowing convenience; the wire keeps the shape callers pin against.
 */
export interface CliErrorPayload {
  /** Stable error code (e.g. `"dirty-tree"`) consumers branch on. */
  code: string;
  /** Human-readable summary of the failure. */
  message: string;
  /** Actionable next-step suggestion, when one applies. */
  hint?: string;
  /** Severity; omitted on the default (`"error"`), present only for warnings. */
  severity?: "error" | "warning";
  /** Child errors aggregated under this one (recursive). */
  subErrors?: CliErrorPayload[];
  /** Per-code structured context whose shape varies by `code`. */
  context?: Record<string, unknown>;
}

/**
 * The framework's structured error class. CLIs built on `@dv-cli/clipc` throw
 * subclasses (e.g. `dv`'s `DvError`) so the framework can render them uniformly
 * to either human stderr or a JSON envelope (see {@link renderCliError}).
 *
 * The error's identity lives in a single `kind: TShape` discriminator field, so
 * narrowing `err.kind.code` propagates to `err.kind.context` the way a Rust
 * `enum` variant carries its payload. Envelope concerns — `message`, `hint`,
 * `subErrors`, `severity`, `exitCode`, `cause` — live on the class itself.
 *
 * @typeParam TShape - The discriminated union of `{ code, context? }` arms this
 *   error can take; defaults to {@link DefaultCliErrorShape}.
 *
 * @example
 * ```ts
 * type DvErrorShape =
 *   | { code: "dirty-tree" }
 *   | { code: "plugin-not-executable"; context: { pluginPath: string } };
 * class DvError extends CliError<DvErrorShape> {}
 *
 * throw new DvError({
 *   code: "plugin-not-executable",
 *   context: { pluginPath: "./plugins/cargo" },
 *   message: "Plugin is not executable",
 *   hint: "chmod +x the plugin file",
 *   exitCode: 2,
 * });
 * ```
 */
export class CliError<
  TShape extends CliErrorShape = DefaultCliErrorShape,
> extends Error {
  /**
   * The discriminator field. Narrowing `err.kind.code` propagates to
   * `err.kind.context` because they're parts of one tagged-union value, not
   * separate readonly fields — the whole reason for the nesting.
   */
  readonly kind: TShape;
  /** Actionable next-step suggestion, when one applies. */
  readonly hint?: string;
  /** Severity of the error; defaults to `"error"` when not supplied. */
  readonly severity: "error" | "warning";
  /**
   * Process exit code for this failure; optional because it is a property of
   * what failed, not of transport. The framework defaults to 1 when omitted.
   */
  readonly exitCode?: number;
  /**
   * Child errors aggregated under this one. Erased to the default shape at the
   * array boundary so the parent need not declare their shapes.
   */
  readonly subErrors: CliError[];

  /**
   * Builds a `CliError` from a flat init object, reconstructing the nested
   * `kind` tagged-union value internally.
   *
   * @param init - The error's fields: `code` (and `context` when the arm
   *   requires it), plus `message`, and optional `hint`, `severity`,
   *   `exitCode`, `cause`, and `subErrors`.
   */
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
    this.kind = (
      contextValue !== undefined
        ? { code: init.code, context: contextValue }
        : { code: init.code }
    ) as TShape;
    this.hint = init.hint;
    this.severity = init.severity ?? "error";
    this.exitCode = init.exitCode;
    this.subErrors = init.subErrors ?? [];
  }

  /**
   * Serializes the error tree to the flat {@link CliErrorPayload} wire shape,
   * flattening `kind` back to top-level `code` / `context`. Omits the default
   * `severity` and empty `subErrors` / `context` so the format stays terse.
   * Recursive — each sub-error serializes itself.
   *
   * @returns The JSON-envelope payload for this error and its sub-errors.
   */
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
