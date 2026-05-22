import { assertEquals, assertThrows } from "@std/assert";
import { PluginError } from "../../domain/errors.ts";
import { parseDiscoverResponse } from "./response.ts";

Deno.test("parseDiscoverResponse accepts a well-formed discover payload", () => {
  // Given a plugin that emitted a contract-valid discover response
  const validStdout = `{"packages":[{"name":"core","path":"packages/core"}]}`;

  // When the response is parsed
  const validatedResponse = parseDiscoverResponse({
    rawStdout: validStdout,
    pluginPath: "/x/plugin",
  });

  // Then the response carries exactly one package with the declared shape
  assertEquals(validatedResponse.packages.length, 1);
  assertEquals(validatedResponse.packages[0]?.name, "core");
  assertEquals(validatedResponse.packages[0]?.path, "packages/core");
});

Deno.test("parseDiscoverResponse rejects an empty stdout as a bad response", () => {
  // Given a plugin that exited 0 but printed nothing to stdout
  const emptyStdout = "";

  // When the response is parsed
  // Then it throws PluginError mentioning the empty stdout
  assertThrows(
    () => parseDiscoverResponse({ rawStdout: emptyStdout, pluginPath: "/x" }),
    PluginError,
    "empty",
  );
});

Deno.test("parseDiscoverResponse rejects non-JSON stdout", () => {
  // Given a plugin that wrote unstructured text instead of JSON
  const garbageStdout = "not json";

  // When the response is parsed
  // Then PluginError surfaces the JSON parse failure
  assertThrows(
    () => parseDiscoverResponse({ rawStdout: garbageStdout, pluginPath: "/x" }),
    PluginError,
    "valid JSON",
  );
});

Deno.test("parseDiscoverResponse rejects a JSON object without 'packages'", () => {
  // Given JSON that's valid but missing the required `packages` array
  const missingPackagesStdout = `{"ok": true}`;

  // When the response is parsed
  // Then PluginError points at the schema violation
  assertThrows(
    () =>
      parseDiscoverResponse({
        rawStdout: missingPackagesStdout,
        pluginPath: "/x",
      }),
    PluginError,
  );
});

Deno.test("parseDiscoverResponse surfaces a plugin's structured error envelope", () => {
  // Given a plugin that emitted the `{ ok: false, error: "..." }` envelope
  const errorEnvelopeStdout = `{"ok":false,"error":"manifest gone"}`;

  // When the response is parsed
  // Then the envelope's message becomes the PluginError reason
  assertThrows(
    () =>
      parseDiscoverResponse({
        rawStdout: errorEnvelopeStdout,
        pluginPath: "/x",
      }),
    PluginError,
    "manifest gone",
  );
});

Deno.test("parseDiscoverResponse rejects a package entry missing a required field", () => {
  // Given a packages[] entry without the `path` field
  const partialPackageStdout = `{"packages":[{"name":"core"}]}`;

  // When the response is parsed
  // Then PluginError flags the missing field
  assertThrows(
    () =>
      parseDiscoverResponse({
        rawStdout: partialPackageStdout,
        pluginPath: "/x",
      }),
    PluginError,
  );
});
