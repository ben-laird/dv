import { assertEquals } from "@std/assert";
import { z } from "zod";
import type {
  InferInput,
  InferOutput,
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "./standard-schema.ts";

// Compile-time equality: `true` only when the two types are identical.
type IsExact<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <
    Probe,
  >() => Probe extends Right ? 1 : 2
    ? true
    : false;

Deno.test("StandardSchemaV1 accepts a hand-written schema and infers its types", async () => {
  // Given a hand-written schema that reads digits as a number
  const digits: StandardSchemaV1<string, number> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        if (typeof value === "string" && /^\d+$/.test(value)) {
          return { value: Number(value) };
        }
        return { issues: [{ message: "expected digits" }] };
      },
    },
  };

  // When it validates good and bad input
  const good = await digits["~standard"].validate("42");
  const bad = await digits["~standard"].validate("x");

  // Then it yields the value or the issues, and its types infer
  assertEquals(good, { value: 42 });
  assertEquals(bad, { issues: [{ message: "expected digits" }] });
  const inputIsString: IsExact<InferInput<typeof digits>, string> = true;
  const outputIsNumber: IsExact<InferOutput<typeof digits>, number> = true;
  assertEquals([inputIsString, outputIsNumber], [true, true]);
});

Deno.test("Zod schemas satisfy the vendored StandardSchemaV1 and StandardJSONSchemaV1", () => {
  // Given a Zod enum
  const color = z.enum(["always", "never"]);

  // When it is assigned to both vendored interfaces
  const asSchema: StandardSchemaV1<"always" | "never"> = color;
  const asJsonSchema: StandardJSONSchemaV1<"always" | "never"> = color;

  // Then both compile, and the converter answers the spec's call shape
  assertEquals(asSchema["~standard"].version, 1);
  assertEquals(
    asJsonSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" })
      .enum,
    ["always", "never"],
  );
});
