---
type: 'feat'
packages:
  - '@dv-cli/clipc'
links:
  - https://github.com/ben-laird/dv/issues/51
---

# Validate and type flag values with a Standard Schema

A `string`, `collect` or `optional-value` flag can take a `schema`: any
[Standard Schema](https://standardschema.dev), such as Zod 4, Valibot or
ArkType. Each value typed is validated before `run`, and `run` sees the
schema's output: `{ kind: "string", schema: z.coerce.number() }` gives
`number | undefined`, a `collect` flag a list of outputs (each element
validated), and an `optional-value` flag `boolean` or the output. clipc
vendors the spec's types and takes no new dependency; the types are
exported (`StandardSchemaV1`, `InferInput`, `InferOutput`, …).

argv holds only text, so a schema must take a string input:
`z.coerce.number()` and `z.enum([...])` type-check, and `z.number()` is a
type error at `command()`, `forCtx().command` and `inheritedFlags`.
Validation is a separate step after lexing and is awaited, so async
schemas work. Absent flags aren't validated, and `--help` returns first.

A refused value is the existing `invalid-flag-value` error (exit 2) with
the schema's messages; a `collect` flag names the element by place
(`invalid value 'x' for '--port #2': …`), and the error context gains an
optional `element` (counting from 1) for it. A schema that fails without
issues reads `the value was refused`. A schema that throws, rejects, or
returns a result the spec doesn't allow is a new `flag-schema-failed` error with exit 1 (`the schema for '--port'
failed: <message>`, context `{ flagName, value, element?, message }`),
caught at the edge instead of escaping as an exception. On an `optional-value` flag, `schema` and `choices` exclude each
other; `booleans: true` composes with either.

`--help` shows a schema flag's `valueName`, else the string choices its
Standard JSON Schema lists (`--color <always|never>` for a Zod enum), else
`<value>`.
