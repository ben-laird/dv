import { assertEquals, assertThrows } from "@std/assert";
import { DvError } from "../../domain/errors.ts";
import { parseDurationMs } from "./duration.ts";

Deno.test("parseDurationMs accepts every documented unit suffix", () => {
  // Given the four units documented in specs/schemas/config.json $defs/duration
  const durationsByUnit = {
    milliseconds: { input: "500ms", expectedMs: 500 },
    seconds: { input: "60s", expectedMs: 60_000 },
    minutes: { input: "5m", expectedMs: 300_000 },
    hours: { input: "1h", expectedMs: 3_600_000 },
  };

  // When parseDurationMs is called for each unit
  // Then it returns the millisecond equivalent
  for (const { input, expectedMs } of Object.values(durationsByUnit)) {
    assertEquals(
      parseDurationMs({ durationString: input, breadcrumb: "x.timeout" }),
      expectedMs,
    );
  }
});

Deno.test("parseDurationMs rejects strings that don't match the duration regex", () => {
  // Given inputs that omit the unit, use an unknown unit, or are free-form
  const malformedDurationInputs = ["60", "five seconds", "60d", "", "1.5s"];

  // When parseDurationMs is called for each malformed value
  // Then each call throws DvError
  for (const malformedDurationInput of malformedDurationInputs) {
    assertThrows(
      () =>
        parseDurationMs({
          durationString: malformedDurationInput,
          breadcrumb: "x.timeout",
        }),
      DvError,
    );
  }
});
