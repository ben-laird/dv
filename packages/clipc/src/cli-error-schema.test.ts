import { assertEquals } from "@std/assert";
import { rawCliErrorEnvelopeSchema } from "./cli-error-schema.ts";
import { CliError } from "./errors.ts";

Deno.test("rawCliErrorEnvelopeSchema accepts the wire shape CliError.toJSON produces", () => {
  // Given a populated CliError tree wrapped in the envelope shape
  // renderCliError emits under --json mode
  const populatedError = new CliError({
    code: "release-partial-failure",
    message: "1 package failed to publish",
    hint: "rerun dv release --force after fixing the cause",
    context: { totalAttempted: 3 },
    subErrors: [
      new CliError({
        code: "publish-failed",
        message: "jsr token expired",
        context: { package: "pkg-a", tag: "pkg-a@1.0.0" },
      }),
    ],
  });
  const envelope = {
    schema: "urn:dv:schema:v1:cli-error",
    error: populatedError.toJSON(),
  };

  // When the envelope is run through the Zod source schema
  const parseResult = rawCliErrorEnvelopeSchema.safeParse(envelope);

  // Then it parses cleanly — the in-process toJSON contract and the
  // wire schema agree by construction
  assertEquals(parseResult.success, true);
  if (parseResult.success) {
    assertEquals(parseResult.data.error.code, "release-partial-failure");
    assertEquals(parseResult.data.error.subErrors?.length, 1);
    assertEquals(parseResult.data.error.subErrors?.[0]?.code, "publish-failed");
  }
});

Deno.test("rawCliErrorEnvelopeSchema accepts a minimal payload (code + message only)", () => {
  // Given the smallest valid envelope — no hint, no context, no
  // subErrors, default severity stripped
  const minimalEnvelope = {
    schema: "urn:dv:schema:v1:cli-error",
    error: {
      code: "dirty-tree",
      message: "working tree is not clean",
    },
  };

  // When parsed
  const parseResult = rawCliErrorEnvelopeSchema.safeParse(minimalEnvelope);

  // Then the strict shape still accepts it — required fields are
  // only `code` + `message`; the rest are optional
  assertEquals(parseResult.success, true);
});

Deno.test("rawCliErrorEnvelopeSchema rejects unknown top-level keys (strict envelope)", () => {
  // Given an envelope with an extra field a consumer might tack on
  const malformedEnvelope = {
    schema: "urn:dv:schema:v1:cli-error",
    error: { code: "x", message: "y" },
    extra: "should not be here",
  };

  // When parsed
  const parseResult = rawCliErrorEnvelopeSchema.safeParse(malformedEnvelope);

  // Then strictness rejects it — forward-compat probing should fail
  // loudly so the contract isn't extended by accident
  assertEquals(parseResult.success, false);
});

Deno.test("rawCliErrorEnvelopeSchema recurses through subErrors arbitrarily deep", () => {
  // Given a 4-deep nested envelope (each level wrapping the previous)
  const leafPayload = { code: "leaf", message: "innermost" };
  let currentPayload: Record<string, unknown> = leafPayload;
  for (let depth = 0; depth < 3; depth++) {
    currentPayload = {
      code: `level-${depth}`,
      message: `wrapper ${depth}`,
      subErrors: [currentPayload],
    };
  }
  const deeplyNestedEnvelope = {
    schema: "urn:dv:schema:v1:cli-error",
    error: currentPayload,
  };

  // When parsed
  const parseResult = rawCliErrorEnvelopeSchema.safeParse(deeplyNestedEnvelope);

  // Then the recursion works at every level — the schema's z.lazy
  // self-reference holds across the tree
  assertEquals(parseResult.success, true);
});
