/**
 * The Standard Schema v1 interface and its Standard JSON Schema extension,
 * declared locally so clipc has no runtime dependency (the spec invites
 * copying its types).
 *
 * Copied from `@standard-schema/spec` 1.1.0 (https://standardschema.dev and
 * https://standardschema.dev/json-schema), flattened from its namespaces into
 * prefixed names. The `StandardTypedV1` base is folded into
 * {@link StandardSchemaV1Props}. The JSON Schema converter is a separate
 * capability ({@link StandardJSONSchemaV1}): a schema may or may not offer it,
 * so clipc only reads it after checking it is there.
 *
 * @module
 */

/**
 * A Standard Schema: any value with a `~standard` property. Zod, Valibot,
 * ArkType and other libraries implement it.
 *
 * @typeParam Input - The input type the schema declares.
 * @typeParam Output - The output type a successful validation yields.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1Props<Input, Output>;
}

/**
 * The properties under a Standard Schema's `~standard` key.
 *
 * @typeParam Input - The input type the schema declares.
 * @typeParam Output - The output type a successful validation yields.
 */
export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  /** The version number of the standard. */
  readonly version: 1;
  /** The vendor name of the schema library. */
  readonly vendor: string;
  /** Validates unknown input values. */
  readonly validate: (
    value: unknown,
    options?: StandardSchemaV1Options | undefined,
  ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  /** Inferred types associated with the schema; for type inference only. */
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

/** The options a caller may pass to a Standard Schema's `validate`. */
export interface StandardSchemaV1Options {
  /** Implicit support for additional vendor-specific parameters, if needed. */
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

/**
 * The result of a Standard Schema's `validate`.
 *
 * @typeParam Output - The output type a successful validation yields.
 */
export type StandardSchemaV1Result<Output> =
  | StandardSchemaV1SuccessResult<Output>
  | StandardSchemaV1FailureResult;

/**
 * The result of a successful validation.
 *
 * @typeParam Output - The output type.
 */
export interface StandardSchemaV1SuccessResult<Output> {
  /** The typed output value. */
  readonly value: Output;
  /** The absence of issues indicates success. */
  readonly issues?: undefined;
}

/** The result of a failed validation. */
export interface StandardSchemaV1FailureResult {
  /** The issues of failed validation. */
  readonly issues: ReadonlyArray<StandardSchemaV1Issue>;
}

/** One issue of a failed Standard Schema validation. */
export interface StandardSchemaV1Issue {
  /** The error message of the issue. */
  readonly message: string;
  /** The path of the issue, if any. */
  readonly path?:
    | ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment>
    | undefined;
}

/** A path segment of a {@link StandardSchemaV1Issue}, as an object. */
export interface StandardSchemaV1PathSegment {
  /** The key representing a path segment. */
  readonly key: PropertyKey;
}

/**
 * The input and output types a Standard Schema declares.
 *
 * @typeParam Input - The input type.
 * @typeParam Output - The output type.
 */
export interface StandardSchemaV1Types<Input = unknown, Output = Input> {
  /** The input type of the schema. */
  readonly input: Input;
  /** The output type of the schema. */
  readonly output: Output;
}

/**
 * The input type a Standard Schema declares.
 *
 * @typeParam Schema - The Standard Schema.
 */
export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
  Schema["~standard"]["types"]
>["input"];

/**
 * The output type a Standard Schema declares.
 *
 * @typeParam Schema - The Standard Schema.
 */
export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
  Schema["~standard"]["types"]
>["output"];

/**
 * A Standard JSON Schema: a value whose `~standard` property can convert the
 * schema's input or output type to JSON Schema. Zod (4.2 and later) and
 * ArkType (2.1.28 and later) implement it beside {@link StandardSchemaV1}.
 *
 * @typeParam Input - The input type the schema declares.
 * @typeParam Output - The output type a successful validation yields.
 */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  /** The Standard JSON Schema properties. */
  readonly "~standard": StandardJSONSchemaV1Props<Input, Output>;
}

/**
 * The properties under a Standard JSON Schema's `~standard` key.
 *
 * @typeParam Input - The input type the schema declares.
 * @typeParam Output - The output type a successful validation yields.
 */
export interface StandardJSONSchemaV1Props<Input = unknown, Output = Input> {
  /** The version number of the standard. */
  readonly version: 1;
  /** The vendor name of the schema library. */
  readonly vendor: string;
  /** Inferred types associated with the schema; for type inference only. */
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
  /** Methods for generating the input/output JSON Schema. */
  readonly jsonSchema: StandardJSONSchemaV1Converter;
}

/** The Standard JSON Schema converter. Either method may throw. */
export interface StandardJSONSchemaV1Converter {
  /** Converts the input type to JSON Schema. May throw if conversion is not supported. */
  readonly input: (
    options: StandardJSONSchemaV1Options,
  ) => Record<string, unknown>;
  /** Converts the output type to JSON Schema. May throw if conversion is not supported. */
  readonly output: (
    options: StandardJSONSchemaV1Options,
  ) => Record<string, unknown>;
}

/**
 * The target version of the generated JSON Schema. Implementers are strongly
 * recommended to support `"draft-2020-12"` and `"draft-07"`; any other string
 * is accepted for future targets, and a library throws for one it lacks.
 */
// The spec spells the last arm `{} & string`; `Record<never, never>` is the
// same empty object type, so any string is accepted with autocomplete kept.
export type StandardJSONSchemaV1Target =
  | "draft-2020-12"
  | "draft-07"
  | "openapi-3.0"
  | (string & Record<never, never>);

/** The options for a {@link StandardJSONSchemaV1Converter} method. */
export interface StandardJSONSchemaV1Options {
  /** The target version of the generated JSON Schema. */
  readonly target: StandardJSONSchemaV1Target;
  /** Implicit support for additional vendor-specific parameters, if needed. */
  readonly libraryOptions?: Record<string, unknown> | undefined;
}
