import { dirname } from "@std/path";
import { DvError } from "../../domain/errors.ts";
import { loadRenameLedger } from "./load.ts";

// Append-only writer for `.dv/renames.yaml`. Powers `dv rename`.
//
// We deliberately do NOT round-trip the file through @std/yaml — that
// would re-serialize, destroying any header comments or per-entry
// annotations the user has hand-added (the ledger is meant to be a
// human-readable record of lineage). Instead we read the existing text,
// validate it via loadRenameLedger to surface duplicate-from / shape
// errors before we touch anything, then write the new entry as a
// trailing block in the canonical shape.
//
// The output style matches `loadRenameLedger`'s expectations and the
// example in specs/record-format.md § renames.yaml.

const LEDGER_HEADER_COMMENT =
  "# dv rename ledger — append-only lineage of package renames.\n" +
  "# Each entry maps an old name → its current name, with the new\n" +
  "# package's first version under the new name. See\n" +
  "# specs/record-format.md § renames.yaml.\n";

export interface AppendRenameEntryArgs {
  ledgerPath: string;
  fromPackageName: string;
  toPackageName: string;
  atVersion: string;
}

export interface AppendRenameEntryResult {
  ledgerPath: string;
  fileCreated: boolean;
  appendedYamlBlock: string;
}

export async function appendRenameEntry(
  args: AppendRenameEntryArgs,
): Promise<AppendRenameEntryResult> {
  const { ledgerPath, fromPackageName, toPackageName, atVersion } = args;

  // Validate inputs match the schema's `.min(1)` constraints before
  // mutating anything; emit DvErrors so the framework can render
  // them consistently with the rest of the CLI.
  assertNonEmpty({ field: "from", value: fromPackageName });
  assertNonEmpty({ field: "to", value: toPackageName });
  assertNonEmpty({ field: "at", value: atVersion });

  // Load to validate existing shape AND detect duplicate `from` edges
  // before we append (otherwise the next loader call would throw).
  const existingLedger = await loadRenameLedger({ ledgerPath });
  for (const existingEntry of existingLedger) {
    if (existingEntry.from === fromPackageName) {
      throw new DvError({
        code: "ledger-duplicate-edge",
        message: `rename ledger already has an outgoing edge from '${fromPackageName}' (→ '${existingEntry.to}') — the closure must be functional (one current name per old reference)`,
        hint: `to chain renames, append \`from: ${existingEntry.to} → to: ${toPackageName}\` instead`,
        context: { ledgerPath, from: fromPackageName },
      });
    }
  }

  let existingText = "";
  let fileCreated = false;
  try {
    existingText = await Deno.readTextFile(ledgerPath);
  } catch (caughtError) {
    if (!(caughtError instanceof Deno.errors.NotFound)) throw caughtError;
    fileCreated = true;
  }

  if (fileCreated) {
    await Deno.mkdir(dirname(ledgerPath), { recursive: true });
  }

  const newEntryYaml = formatLedgerEntry({
    fromPackageName,
    toPackageName,
    atVersion,
  });
  const newFileText = fileCreated
    ? `${LEDGER_HEADER_COMMENT}\n${newEntryYaml}`
    : `${appendSeparator(existingText)}${newEntryYaml}`;

  await Deno.writeTextFile(ledgerPath, newFileText);
  return { ledgerPath, fileCreated, appendedYamlBlock: newEntryYaml };
}

interface AssertNonEmptyArgs {
  field: "from" | "to" | "at";
  value: string;
}

function assertNonEmpty(args: AssertNonEmptyArgs): void {
  if (args.value.length > 0) return;
  throw new DvError({
    code: "ledger-shape",
    message: `rename entry \`${args.field}\` must be a non-empty string`,
    context: { ledgerPath: "<append-time>" },
  });
}

interface FormatLedgerEntryArgs {
  fromPackageName: string;
  toPackageName: string;
  atVersion: string;
}

function formatLedgerEntry(args: FormatLedgerEntryArgs): string {
  // The `at` value is quoted because YAML otherwise treats "1.0" as
  // a float (loses the trailing zero) and "1.0.0" as a string only by
  // coincidence. Quoting keeps every version a string regardless of
  // shape, which matches the example in specs/record-format.md.
  return `- from: ${args.fromPackageName}\n  to: ${args.toPackageName}\n  at: "${args.atVersion}"\n`;
}

function appendSeparator(existingText: string): string {
  if (existingText.length === 0) return "";
  return existingText.endsWith("\n") ? existingText : `${existingText}\n`;
}
