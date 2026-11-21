import { assertEquals, assertInstanceOf } from "@std/assert";
import { z } from "zod";
import { safeParseCliErrorEnvelope } from "../cli-error-schema.ts";
import { CliError } from "../errors.ts";
import type { FlagSpec, FlagsOf } from "../flag-spec.ts";
import { renderCliError } from "../render-cli-error.ts";
import type { StandardSchemaV1 } from "../standard-schema.ts";
import { command } from "./command.ts";
import { forCtx, inheritedFlags } from "./router.ts";
import { type CliResponse, done, type Step } from "./types.ts";

// Compile-time equality: `true` only when the two types are identical.
type IsExact<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <
    Probe,
  >() => Probe extends Right ? 1 : 2
    ? true
    : false;

// A hand-written schema that reads digits as a number.
const digits: StandardSchemaV1<string, number> = {
  "~standard": {
    version: 1,
    vendor: "fake",
    validate: (value) => {
      if (typeof value === "string" && /^\d+$/.test(value)) {
        return { value: Number(value) };
      }
      return { issues: [{ message: "expected digits" }] };
    },
  },
};

// Runs a leaf's handler on argv and returns the response it settles on.
async function respond(args: {
  leaf: ReturnType<typeof command>;
  argv: string[];
}): Promise<CliResponse> {
  const step: Step<unknown> = await args.leaf.handler({
    argv: args.argv,
    path: ["cli", "leaf"],
    ctx: undefined,
    colorEnabled: false,
  });
  if (step.kind !== "done") throw new Error("a leaf always settles");
  return step.response;
}

Deno.test("FlagsOf types each value-carrying kind by its schema's output", () => {
  // Given a string, a collect and an optional-value flag with schemas
  const flagSpecMap = {
    count: { kind: "string", schema: digits },
    ports: { kind: "collect", schema: digits },
    retry: { kind: "optional-value", schema: digits },
    plain: { kind: "string" },
  } satisfies Record<string, FlagSpec>;
  type Flags = FlagsOf<typeof flagSpecMap>;

  // When the runner's flag types are read
  const count: IsExact<Flags["count"], number | undefined> = true;
  const ports: IsExact<Flags["ports"], number[] | undefined> = true;
  const retry: IsExact<Flags["retry"], boolean | number | undefined> = true;
  const plain: IsExact<Flags["plain"], string | undefined> = true;

  // Then a scalar is T, a collect T[] (per element), an optional-value T or boolean
  assertEquals([count, ports, retry, plain], [true, true, true, true]);
});

Deno.test("an optional-value flag takes choices or a schema, never both", () => {
  // Given an optional-value flag declaring both
  const both = {
    kind: "optional-value",
    choices: ["null"],
    schema: digits,
  } as const;

  // When it is checked against FlagSpec
  // @ts-expect-error: choices and schema are mutually exclusive
  const spec: FlagSpec = both;

  // Then the type checker refuses it (the value still exists at runtime)
  assertEquals(spec.kind, "optional-value");
});

Deno.test("command accepts a schema that reads strings and refuses one that can't", () => {
  // Given Zod's coercing number, an enum, and a plain number schema
  // When each is a flag's schema
  const coerced = command({
    flags: { count: { kind: "string", schema: z.coerce.number() } },
    run: ({ flags }) => {
      const count: IsExact<typeof flags.count, number | undefined> = true;
      return done({ kind: "ok", json: count });
    },
  });
  const enumerated = command({
    flags: { color: { kind: "collect", schema: z.enum(["a", "b"]) } },
    run: ({ flags }) => {
      const color: IsExact<typeof flags.color, ("a" | "b")[] | undefined> =
        true;
      return done({ kind: "ok", json: color });
    },
  });
  const refused = command({
    // @ts-expect-error: z.number() takes a number, and argv holds only text
    flags: { count: { kind: "string", schema: z.number() } },
    run: () => done({ kind: "ok" }),
  });

  // Then the coercing and enum schemas type-check and z.number() does not
  assertEquals(
    [coerced.kind, enumerated.kind, refused.kind],
    ["command", "command", "command"],
  );
});

Deno.test("forCtx().command and inheritedFlags refuse a schema that can't read strings", () => {
  // Given a Ctx-bound builder
  const builders = forCtx<{ cwd: string }>();

  // When a plain number schema is declared through each
  const leaf = builders.command({
    // @ts-expect-error: z.number() takes a number, and argv holds only text
    flags: { count: { kind: "string", schema: z.number() } },
    run: () => done({ kind: "ok" }),
  });
  const shared = inheritedFlags({
    // @ts-expect-error: z.number() takes a number, and argv holds only text
    port: { kind: "string", schema: z.number() },
  });
  const coerced = inheritedFlags({
    port: { kind: "string", schema: z.coerce.number() },
  });

  // Then both refuse it, and a coercing schema still passes
  assertEquals(
    [leaf.kind, shared.port.kind, coerced.port.kind],
    ["command", "string", "string"],
  );
});

Deno.test("a leaf hands run each flag's schema output", async () => {
  // Given a leaf with an async schema and a collect of digits
  const seen: unknown[] = [];
  const later: StandardSchemaV1<string, string> = {
    "~standard": {
      version: 1,
      vendor: "fake",
      validate: async (value) => {
        await Promise.resolve();
        return { value: String(value).toUpperCase() };
      },
    },
  };
  const leaf = command({
    flags: {
      name: { kind: "string", schema: later },
      port: { kind: "collect", schema: digits },
    },
    run: ({ flags }) => {
      seen.push(flags);
      return done({ kind: "ok" });
    },
  });

  // When values are typed for both
  const response = await respond({
    leaf,
    argv: ["--name", "ada", "--port", "80", "--port", "443"],
  });

  // Then run sees the outputs: the awaited text and the numbers
  assertEquals(response, { kind: "ok" });
  assertEquals(seen, [{ name: "ADA", port: [80, 443] }]);
});

Deno.test("a leaf refuses a collect flag's bad element by place, with exit 2", async () => {
  // Given a leaf whose collect flag reads digits
  const leaf = command({
    flags: { port: { kind: "collect", schema: digits } },
    run: () => done({ kind: "ok" }),
  });

  // When its second value isn't digits
  const response = await respond({
    leaf,
    argv: ["--port", "80", "--port", "http"],
  });

  // Then an invalid-flag-value error names `--port #2`, and its context
  // (valid in the JSON envelope) carries the element counting from 1
  if (response.kind !== "error") throw new Error("expected an error");
  assertInstanceOf(response.error, CliError);
  assertEquals(response.error.exitCode, 2);
  assertEquals(
    response.error.message,
    "invalid value 'http' for '--port #2': expected digits",
  );
  assertEquals(response.error.kind, {
    code: "invalid-flag-value",
    context: {
      flagName: "port",
      value: "http",
      element: 2,
      issues: [{ message: "expected digits" }],
    },
  });
  const envelope = safeParseCliErrorEnvelope(
    JSON.parse(
      renderCliError({
        err: response.error,
        mode: "json",
        colorEnabled: false,
      }),
    ),
  );
  assertEquals(envelope.success && envelope.data.error.context?.element, 2);
});

Deno.test("a leaf reports a schema that throws as flag-schema-failed, with exit 1", async () => {
  // Given a leaf whose collect flag's schema throws on its second value
  const fragile: StandardSchemaV1<string, string> = {
    "~standard": {
      version: 1,
      vendor: "fake",
      validate: (value) => {
        if (value === "80") return { value };
        throw new Error("lookup table missing");
      },
    },
  };
  const leaf = command({
    flags: { port: { kind: "collect", schema: fragile } },
    run: () => done({ kind: "ok" }),
  });

  // When the second value reaches it
  const response = await respond({
    leaf,
    argv: ["--port", "80", "--port", "443"],
  });

  // Then the failure is the schema's, not the user's: exit 1, no usage hint
  if (response.kind !== "error") throw new Error("expected an error");
  assertInstanceOf(response.error, CliError);
  assertEquals(response.error.exitCode, 1);
  assertEquals(response.error.hint, undefined);
  assertEquals(
    response.error.message,
    "the schema for '--port #2' failed: lookup table missing",
  );
  assertEquals(response.error.kind, {
    code: "flag-schema-failed",
    context: {
      flagName: "port",
      value: "443",
      element: 2,
      message: "lookup table missing",
    },
  });
});

Deno.test("a leaf validates no flag for --help, and no absent flag", async () => {
  // Given a leaf whose schema counts the values it checks
  let checks = 0;
  const counting: StandardSchemaV1<string, string> = {
    "~standard": {
      version: 1,
      vendor: "fake",
      validate: (value) => {
        checks++;
        return { value: String(value) };
      },
    },
  };
  const leaf = command({
    flags: {
      name: { kind: "string", schema: counting },
      json: { kind: "boolean" },
    },
    run: () => done({ kind: "ok" }),
  });

  // When help is asked beside a value, and when the flag is left out
  const help = await respond({ leaf, argv: ["--name", "x", "--help"] });
  const absent = await respond({ leaf, argv: ["--json"] });

  // Then help short-circuits and an absent flag has nothing to check
  assertEquals(help.kind, "help");
  assertEquals(absent, { kind: "ok" });
  assertEquals(checks, 0);
});
