import { assertEquals, assertThrows } from "@std/assert";
import { PluginError } from "../../domain/errors.ts";
import {
  parseDiscoverResponse,
  parseReadVersionResponse,
  parseUpdateDependencyResponse,
  parseWriteVersionResponse,
} from "./response.ts";

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

Deno.test("parseReadVersionResponse accepts a well-formed SemVer payload", () => {
  // Given a plugin reporting a current version
  const validStdout = `{"version":"1.4.2"}`;

  // When parsed
  const validatedResponse = parseReadVersionResponse({
    rawStdout: validStdout,
    pluginPath: "/x",
  });

  // Then the version string round-trips faithfully
  assertEquals(validatedResponse.version, "1.4.2");
});

Deno.test("parseReadVersionResponse accepts the documented '0.0.0' default", () => {
  // Given a plugin reporting the no-version-yet default
  const zeroStdout = `{"version":"0.0.0"}`;

  // When parsed
  const validatedResponse = parseReadVersionResponse({
    rawStdout: zeroStdout,
    pluginPath: "/x",
  });

  // Then it parses cleanly — the algebra treats 0.0.0 as Unstable
  assertEquals(validatedResponse.version, "0.0.0");
});

Deno.test("parseReadVersionResponse rejects a non-SemVer version string", () => {
  // Given a plugin that emitted something that does not look like SemVer
  const garbageVersionStdout = `{"version":"v1.2-beta"}`;

  // When parsed
  // Then PluginError flags the regex violation before parseVersion runs
  assertThrows(
    () =>
      parseReadVersionResponse({
        rawStdout: garbageVersionStdout,
        pluginPath: "/x",
      }),
    PluginError,
    "read-version",
  );
});

Deno.test("parseWriteVersionResponse accepts the {ok: true} acknowledgement", () => {
  // Given the documented success response
  const validStdout = `{"ok":true}`;

  // When parsed
  const validatedResponse = parseWriteVersionResponse({
    rawStdout: validStdout,
    pluginPath: "/x",
  });

  // Then `ok` is the literal true (a schema-strict shape)
  assertEquals(validatedResponse.ok, true);
});

Deno.test("parseWriteVersionResponse rejects ok:false (use the error envelope instead)", () => {
  // Given a plugin that wrongly emits {ok: false} without an `error` field
  const wrongOkStdout = `{"ok":false}`;

  // When parsed
  // Then PluginError surfaces — write-version's success contract is
  // strict `ok: true`; signaling failure goes through the error envelope
  assertThrows(
    () =>
      parseWriteVersionResponse({
        rawStdout: wrongOkStdout,
        pluginPath: "/x",
      }),
    PluginError,
  );
});

Deno.test("parseUpdateDependencyResponse accepts {ok:true, changed:true}", () => {
  // Given a plugin that rewrote a real constraint
  const validStdout = `{"ok":true,"changed":true}`;

  // When parsed
  const validatedResponse = parseUpdateDependencyResponse({
    rawStdout: validStdout,
    pluginPath: "/x",
  });

  // Then the parsed shape carries changed:true
  assertEquals(validatedResponse, { ok: true, changed: true });
});

Deno.test("parseUpdateDependencyResponse accepts {ok:true, changed:false} as the no-op path", () => {
  // Given a plugin reporting that the dependent doesn't carry this dep
  const noOpStdout = `{"ok":true,"changed":false}`;

  // When parsed
  const validatedResponse = parseUpdateDependencyResponse({
    rawStdout: noOpStdout,
    pluginPath: "/x",
  });

  // Then changed:false is a normal success (constraint-only cascading
  // per language.md Algebra §9 — dv's plan-builder reports the cross
  // product; the plugin filters by actual manifest content)
  assertEquals(validatedResponse, { ok: true, changed: false });
});

Deno.test("parseUpdateDependencyResponse rejects a response missing `changed`", () => {
  // Given a plugin that returned only {ok:true} (the write-version shape)
  const missingChangedStdout = `{"ok":true}`;

  // When parsed
  // Then PluginError flags the missing field
  assertThrows(
    () =>
      parseUpdateDependencyResponse({
        rawStdout: missingChangedStdout,
        pluginPath: "/x",
      }),
    PluginError,
    "update-dependency",
  );
});

Deno.test("parseUpdateDependencyResponse rejects ok:false (failures go through the error envelope)", () => {
  // Given a plugin that wrongly emits {ok:false, changed:false} without
  // the error envelope's `error` field
  const wrongOkStdout = `{"ok":false,"changed":false}`;

  // When parsed
  // Then PluginError surfaces — ok must be strict literal true
  assertThrows(
    () =>
      parseUpdateDependencyResponse({
        rawStdout: wrongOkStdout,
        pluginPath: "/x",
      }),
    PluginError,
  );
});
