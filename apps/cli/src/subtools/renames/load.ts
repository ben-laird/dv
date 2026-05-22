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
//
// RenameLedgerError keeps a class identity so resolve.ts's
// cycle/duplicate detection can throw a related error tagged the same
// way. The path it carries moves into `kind.context.ledgerPath` to
// match the structured error model.

export class RenameLedgerError extends DvError {
  get ledgerPath(): string {
    // Every variant the constructor accepts (ledger-parse,
    // ledger-shape, ledger-duplicate-edge, ledger-cycle) declares
    // `context.ledgerPath: string`. The cast walks past the
    // `unknown` arm (no context) — only those four codes are used
    // at our throw sites.
    return (this.kind as unknown as { context: { ledgerPath: string } }).context
      .ledgerPath;
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
    throw new RenameLedgerError({
      code: "ledger-parse",
      message: `failed to parse ${ledgerPath}: ${yamlMessage}`,
      context: { ledgerPath },
    });
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
  return new RenameLedgerError({
    code: "ledger-shape",
    message: `${args.ledgerPath} @ ${issuePath}: ${issueMessage}`,
    context: { ledgerPath: args.ledgerPath },
  });
}
