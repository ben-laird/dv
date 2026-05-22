import { assertEquals, assertThrows } from "@std/assert";
import { DvError } from "../../domain/errors.ts";
import {
  parseDiscoverResponse,
  parseReadVersionResponse,
  parseReleaseResponse,
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
  // Then it throws DvError mentioning the empty stdout
  assertThrows(
    () => parseDiscoverResponse({ rawStdout: emptyStdout, pluginPath: "/x" }),
    DvError,
    "empty",
  );
});

Deno.test("parseDiscoverResponse rejects non-JSON stdout", () => {
  // Given a plugin that wrote unstructured text instead of JSON
  const garbageStdout = "not json";

  // When the response is parsed
  // Then DvError surfaces the JSON parse failure
  assertThrows(
    () => parseDiscoverResponse({ rawStdout: garbageStdout, pluginPath: "/x" }),
    DvError,
    "valid JSON",
  );
});

Deno.test("parseDiscoverResponse rejects a JSON object without 'packages'", () => {
  // Given JSON that's valid but missing the required `packages` array
  const missingPackagesStdout = `{"ok": true}`;

  // When the response is parsed
  // Then DvError points at the schema violation
  assertThrows(
    () =>
      parseDiscoverResponse({
        rawStdout: missingPackagesStdout,
        pluginPath: "/x",
      }),
    DvError,
  );
});

Deno.test("parseDiscoverResponse surfaces a plugin's structured error envelope", () => {
  // Given a plugin that emitted the `{ ok: false, error: "..." }` envelope
  const errorEnvelopeStdout = `{"ok":false,"error":"manifest gone"}`;

  // When the response is parsed
  // Then the envelope's message becomes the DvError reason
  assertThrows(
    () =>
      parseDiscoverResponse({
        rawStdout: errorEnvelopeStdout,
        pluginPath: "/x",
      }),
    DvError,
    "manifest gone",
  );
});

Deno.test("parseDiscoverResponse rejects a package entry missing a required field", () => {
  // Given a packages[] entry without the `path` field
  const partialPackageStdout = `{"packages":[{"name":"core"}]}`;

  // When the response is parsed
  // Then DvError flags the missing field
  assertThrows(
    () =>
      parseDiscoverResponse({
        rawStdout: partialPackageStdout,
        pluginPath: "/x",
      }),
    DvError,
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
  // Then DvError flags the regex violation before parseVersion runs
  assertThrows(
    () =>
      parseReadVersionResponse({
        rawStdout: garbageVersionStdout,
        pluginPath: "/x",
      }),
    DvError,
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
  // Then DvError surfaces — write-version's success contract is
  // strict `ok: true`; signaling failure goes through the error envelope
  assertThrows(
    () =>
      parseWriteVersionResponse({
        rawStdout: wrongOkStdout,
        pluginPath: "/x",
      }),
    DvError,
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
  // Then DvError flags the missing field
  assertThrows(
    () =>
      parseUpdateDependencyResponse({
        rawStdout: missingChangedStdout,
        pluginPath: "/x",
      }),
    DvError,
    "update-dependency",
  );
});

Deno.test("parseUpdateDependencyResponse rejects ok:false (failures go through the error envelope)", () => {
  // Given a plugin that wrongly emits {ok:false, changed:false} without
  // the error envelope's `error` field
  const wrongOkStdout = `{"ok":false,"changed":false}`;

  // When parsed
  // Then DvError surfaces — ok must be strict literal true
  assertThrows(
    () =>
      parseUpdateDependencyResponse({
        rawStdout: wrongOkStdout,
        pluginPath: "/x",
      }),
    DvError,
  );
});

Deno.test("parseReleaseResponse accepts the minimal {ok:true} success shape", () => {
  // Given the simplest publish-succeeded response
  const validStdout = `{"ok":true}`;

  // When parsed
  const validatedResponse = parseReleaseResponse({
    rawStdout: validStdout,
    pluginPath: "/x",
  });

  // Then ok:true comes back with the optional fields absent
  assertEquals(validatedResponse.ok, true);
  assertEquals(validatedResponse.published, undefined);
});

Deno.test("parseReleaseResponse accepts a richly-populated success", () => {
  // Given a plugin that reports all the optional fields
  const validStdout = `{"ok":true,"published":true,"skipped":false,"message":"published to jsr"}`;

  // When parsed
  const validatedResponse = parseReleaseResponse({
    rawStdout: validStdout,
    pluginPath: "/x",
  });

  // Then every field is preserved
  assertEquals(validatedResponse.ok, true);
  assertEquals(validatedResponse.published, true);
  assertEquals(validatedResponse.skipped, false);
  assertEquals(validatedResponse.message, "published to jsr");
});

Deno.test("parseReleaseResponse accepts {ok:false, message:'...'} as a structured failure (not a thrown error)", () => {
  // Given the documented "publish failed but don't roll back the tag"
  // shape — release is the ONLY Op where ok:false flows back to the
  // caller instead of throwing (specs/plugin-contract.md: "Failures
  // here do not roll back the tags")
  const failureStdout = `{"ok":false,"message":"jsr: package name taken"}`;

  // When parsed
  const validatedResponse = parseReleaseResponse({
    rawStdout: failureStdout,
    pluginPath: "/x",
  });

  // Then the failure surfaces as data the caller can aggregate into
  // a summary — NOT a thrown DvError
  assertEquals(validatedResponse.ok, false);
  assertEquals(validatedResponse.message, "jsr: package name taken");
});

Deno.test("parseReleaseResponse rejects shapes missing the required `ok` field", () => {
  // Given a plugin that forgot to emit the `ok` field
  const missingOkStdout = `{"published":true}`;

  // When parsed
  // Then DvError surfaces — `ok` is the only required field
  assertThrows(
    () =>
      parseReleaseResponse({
        rawStdout: missingOkStdout,
        pluginPath: "/x",
      }),
    DvError,
  );
});

Deno.test("parseReleaseResponse rejects unknown extra fields (strict shape)", () => {
  // Given a plugin emitting a field the contract does not define
  const extraFieldStdout = `{"ok":true,"unsupported":"value"}`;

  // When parsed
  // Then DvError surfaces — typos and forward-compat probing
  // should fail loudly rather than silently
  assertThrows(
    () =>
      parseReleaseResponse({
        rawStdout: extraFieldStdout,
        pluginPath: "/x",
      }),
    DvError,
  );
});
