import { ConfigError } from "../../domain/errors.ts";

// Parses durations of the form "60s", "5m", "500ms", "1h" (the config
// schema's $defs/duration). "none" is handled by callers, not here.

const DURATION_REGEX = /^(\d+)(ms|s|m|h)$/;

interface ParseDurationMsArgs {
  durationString: string;
  breadcrumb: string;
}

export function parseDurationMs(args: ParseDurationMsArgs): number {
  const matchedDuration = DURATION_REGEX.exec(args.durationString);
  if (!matchedDuration) {
    throw new ConfigError(
      "config-shape",
      `${args.breadcrumb} must look like '60s', '5m', '500ms', '1h'; got '${args.durationString}'`,
    );
  }
  const numericQuantity = Number(matchedDuration[1]);
  switch (matchedDuration[2]) {
    case "ms":
      return numericQuantity;
    case "s":
      return numericQuantity * 1_000;
    case "m":
      return numericQuantity * 60_000;
    case "h":
      return numericQuantity * 3_600_000;
    default:
      throw new ConfigError(
        "config-shape",
        `unreachable: malformed duration unit in '${args.durationString}'`,
      );
  }
}
