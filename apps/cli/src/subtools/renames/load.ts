import { parse as parseYaml } from "@std/yaml";
import type { z } from "zod";
import { DvError } from "../../domain/errors.ts";
import type { Rename } from "../../domain/rename.ts";
import { renameLedgerSchema } from "./schema.ts";

// Loads the rename ledger from .changelog/renames.yaml. Missing file is
// not an error — it just means "no renames yet"; we return an empty
// ledger. Cycle detection happens at resolve time, not load time, since
// a cycle is a *runtime* invariant violation (Algebra §8 requires a DAG
// of edges for the closure to be a function).

export class RenameLedgerError extends DvError {
  constructor(
    code: string,
    message: string,
    public readonly ledgerPath: string,
  ) {
    super(code, message);
    this.name = "RenameLedgerError";
  }
}

interface LoadRenameLedgerArgs {
  ledgerPath: string;
}

export async function loadRenameLedger(
  args: LoadRenameLedgerArgs,
): Promise<Rename[]> {
  const { ledgerPath } = args;
  let rawText: string;
  try {
    rawText = await Deno.readTextFile(ledgerPath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) return [];
    throw caughtError;
  }
  return parseLedgerText({ rawText, ledgerPath });
}

interface ParseLedgerTextArgs {
  rawText: string;
  ledgerPath: string;
}

function parseLedgerText(args: ParseLedgerTextArgs): Rename[] {
  const { rawText, ledgerPath } = args;
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(rawText);
  } catch (caughtError) {
    const yamlMessage =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    throw new RenameLedgerError(
      "ledger-parse",
      `failed to parse ${ledgerPath}: ${yamlMessage}`,
      ledgerPath,
    );
  }
  if (parsedYaml === null || parsedYaml === undefined) return [];

  const validationResult = renameLedgerSchema.safeParse(parsedYaml);
  if (!validationResult.success) {
    throw ledgerErrorFromZod({
      issues: validationResult.error.issues,
      ledgerPath,
    });
  }
  return validationResult.data.map((ledgerEntry) => ({
    from: ledgerEntry.from,
    to: ledgerEntry.to,
    at: ledgerEntry.at,
  }));
}

interface LedgerErrorFromZodArgs {
  issues: z.core.$ZodIssue[];
  ledgerPath: string;
}

function ledgerErrorFromZod(args: LedgerErrorFromZodArgs): RenameLedgerError {
  const firstIssue = args.issues[0];
  const issuePath =
    firstIssue && firstIssue.path.length > 0
      ? firstIssue.path.join(".")
      : "<root>";
  const issueMessage = firstIssue?.message ?? "invalid";
  return new RenameLedgerError(
    "ledger-shape",
    `${args.ledgerPath} @ ${issuePath}: ${issueMessage}`,
    args.ledgerPath,
  );
}
