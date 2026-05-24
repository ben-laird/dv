import { assertEquals, assertThrows } from "@std/assert";
import { DvError } from "../domain/errors.ts";
import { parsePluginPositional } from "./parse-plugin-positional.ts";

// Round-trip tests for the positional `<plugin>` parser used by
// `dv plugin invoke` and `dv plugin verify`. The parser maps the
// CLI's user-friendly forms onto the same discriminated
// PluginReference the config uses, so the resolver behaves
// identically in both surfaces.

Deno.test("parsePluginPositional honors explicit `path:` prefix", () => {
  // Given a `path:` prefix
  // When parsed
  const result = parsePluginPositional({
    rawPositional: "path:./examples/plugins/deno",
  });
  // Then the result is the path arm verbatim
  assertEquals(result, { path: "./examples/plugins/deno" });
});

Deno.test("parsePluginPositional honors explicit `command:` prefix", () => {
  const result = parsePluginPositional({ rawPositional: "command:cargo-dv" });
  assertEquals(result, { command: "cargo-dv" });
});

Deno.test("parsePluginPositional honors explicit `builtin:` prefix", () => {
  // builtin: arm resolves to a plugin-not-found at resolve time
  // (v1 ships no builtins), but parsing is still valid — the
  // parser is shape-only.
  const result = parsePluginPositional({ rawPositional: "builtin:cargo" });
  assertEquals(result, { builtin: "cargo" });
});

Deno.test("parsePluginPositional honors explicit `run:` prefix (preserves whitespace inside the value)", () => {
  // Given `run:` followed by a tokenizable invocation
  // When parsed
  const result = parsePluginPositional({
    rawPositional: "run:deno run -A ./examples/plugins/deno/main.ts",
  });
  // Then the entire value after the prefix is the run-string;
  // POSIX-tokenization is the resolver's job, not the parser's
  assertEquals(result, {
    run: "deno run -A ./examples/plugins/deno/main.ts",
  });
});

Deno.test("parsePluginPositional shape-infers a path-shaped argument as path:", () => {
  // Given a `./foo` argument with no explicit prefix
  // When parsed
  // Then the shape inference routes to the path arm
  assertEquals(parsePluginPositional({ rawPositional: "./my-plugin" }), {
    path: "./my-plugin",
  });
  assertEquals(parsePluginPositional({ rawPositional: "../sibling/plugin" }), {
    path: "../sibling/plugin",
  });
  assertEquals(parsePluginPositional({ rawPositional: "/abs/path/plugin" }), {
    path: "/abs/path/plugin",
  });
  assertEquals(parsePluginPositional({ rawPositional: "~/dev/plugin" }), {
    path: "~/dev/plugin",
  });
});

Deno.test("parsePluginPositional shape-infers a bare token as command:", () => {
  // Given a plain identifier
  // When parsed
  // Then the inference routes to the command arm ($PATH lookup)
  assertEquals(parsePluginPositional({ rawPositional: "my-plugin" }), {
    command: "my-plugin",
  });
});

Deno.test("parsePluginPositional rejects whitespace in an unprefixed argument with a `run:` hint", () => {
  // Given an unprefixed argument containing whitespace — ambiguous
  // (binary name with space vs. invocation string)
  // When parsed
  // Then a DvError surfaces, pointing the user at the `run:` form
  const caughtError = assertThrows(
    () =>
      parsePluginPositional({
        rawPositional: "deno run -A ./examples/plugins/deno/main.ts",
      }),
    DvError,
  );
  assertEquals(caughtError.kind.code, "plugin-not-found");
});

Deno.test("parsePluginPositional rejects an empty positional", () => {
  const caughtError = assertThrows(
    () => parsePluginPositional({ rawPositional: "   " }),
    DvError,
  );
  assertEquals(caughtError.kind.code, "plugin-not-found");
});

Deno.test("parsePluginPositional rejects a prefix with no value", () => {
  // Given `path:` with no value after the colon
  const caughtError = assertThrows(
    () => parsePluginPositional({ rawPositional: "path:" }),
    DvError,
  );
  assertEquals(caughtError.kind.code, "plugin-not-found");
});
