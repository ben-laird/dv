import { assertEquals } from "@std/assert";
import type { FlagSpec } from "../flag-spec.ts";
import { formatCommandHelp } from "./help.ts";

// The flag lines of a leaf's help, without the usage header.
function flagLines(flags: Record<string, FlagSpec>): string[] {
  const lines = formatCommandHelp({ path: ["mycli", "build"], flags }).split(
    "\n",
  );
  return lines.slice(lines.indexOf("Flags:") + 1);
}

Deno.test("formatCommandHelp renders each kind's default usage unchanged", () => {
  // Given one flag of each kind, none naming its value
  const flags = {
    json: { kind: "boolean", alias: "j", description: "Emit JSON" },
    out: { kind: "string", description: "Output file" },
    pkg: { kind: "collect", description: "Package" },
  } satisfies Record<string, FlagSpec>;

  // When the leaf's help is rendered
  const text = formatCommandHelp({ path: ["mycli", "build"], flags });

  // Then a boolean shows its bare name and value flags show `<kind>`
  assertEquals(
    text,
    [
      "Usage: mycli build [flags] [args...]",
      "",
      "Flags:",
      "  --json             Emit JSON  (-j)",
      "  --out <string>     Output file",
      "  --pkg <collect>    Package",
    ].join("\n"),
  );
});

Deno.test("formatCommandHelp renders a value flag's valueName in place of its kind", () => {
  // Given a string and a collect flag that name their values
  const flags = {
    out: { kind: "string", valueName: "path", description: "Output file" },
    pkg: { kind: "collect", valueName: "name", description: "Package" },
  } satisfies Record<string, FlagSpec>;

  // When the leaf's help is rendered
  const lines = flagLines(flags);

  // Then each shows `--flag <valueName>`, padded to the widest label
  assertEquals(lines, [
    "  --out <path>    Output file",
    "  --pkg <name>    Package",
  ]);
});

Deno.test("formatCommandHelp renders an optional-value flag's declared choices as an optional attachment", () => {
  // Given optional-value flags with one and with several declared choices
  const flags = {
    askOnCommit: {
      kind: "optional-value",
      choices: ["null"],
      description: "Ask before commit",
    },
    color: {
      kind: "optional-value",
      choices: ["always", "never"],
      description: "Colorize",
    },
  } satisfies Record<string, FlagSpec>;

  // When the leaf's help is rendered
  const lines = flagLines(flags);

  // Then each shows `--flag[=value]`, several choices separated by `|`
  assertEquals(lines, [
    "  --askOnCommit[=null]      Ask before commit",
    "  --color[=always|never]    Colorize",
  ]);
});

Deno.test("formatCommandHelp lists the boolean spellings first when booleans is on", () => {
  // Given maat's askOnCommit: choices ["null"] plus booleans
  const flags = {
    askOnCommit: {
      kind: "optional-value",
      choices: ["null"],
      booleans: true,
      description: "Ask before commit",
    },
  } satisfies Record<string, FlagSpec>;

  // When the leaf's help is rendered
  const lines = flagLines(flags);

  // Then every accepted spelling is shown
  assertEquals(lines, [
    "  --askOnCommit[=true|false|null]    Ask before commit",
  ]);
});

Deno.test("formatCommandHelp shows <string> for an optional value with no closed set", () => {
  // Given free-string optional-value flags, one also reading booleans
  const flags = {
    label: { kind: "optional-value", description: "Label" },
    tag: { kind: "optional-value", booleans: true, description: "Tag" },
  } satisfies Record<string, FlagSpec>;

  // When the leaf's help is rendered
  const lines = flagLines(flags);

  // Then the free value reads <string>, after any boolean spellings
  assertEquals(lines, [
    `  --label[=<string>]${" ".repeat(13)}Label`,
    "  --tag[=true|false|<string>]    Tag",
  ]);
});

Deno.test("formatCommandHelp renders an optional-value flag's valueName as an optional attachment", () => {
  // Given an optional-value flag that names its value
  const flags = {
    askOnCommit: {
      kind: "optional-value",
      choices: ["null"],
      valueName: "reset",
      description: "Ask before commit",
    },
  } satisfies Record<string, FlagSpec>;

  // When the leaf's help is rendered
  const lines = flagLines(flags);

  // Then it shows `--flag[=<valueName>]`
  assertEquals(lines, ["  --askOnCommit[=<reset>]    Ask before commit"]);
});
