import type { Rename } from "../../domain/rename.ts";
import { RenameLedgerError } from "./load.ts";

// `resolve(ref, ledger)` from specs/language.md Algebra §8: follow the
// reflexive-transitive closure of the ledger's `from → to` edges to the
// unique current Package, or return undefined for an Unresolved
// Reference.
//
// Cycles in the ledger would make the closure ill-defined; we detect
// them by walking and bailing if a node is revisited. Multiple edges
// from the same `from` are also rejected — they make the closure
// non-functional ("which `to` does `core` resolve to?").

interface BuildResolverArgs {
  ledger: Rename[];
}

export interface RenameResolver {
  resolve(packageReference: string): string | undefined;
}

export function buildRenameResolver(args: BuildResolverArgs): RenameResolver {
  const edgesByFrom = indexEdgesByFrom(args.ledger);
  return {
    resolve(packageReference: string): string | undefined {
      return walkRenameChain({
        startReference: packageReference,
        edgesByFrom,
      });
    },
  };
}

function indexEdgesByFrom(ledger: Rename[]): Map<string, Rename> {
  const edgesByFrom = new Map<string, Rename>();
  for (const ledgerEntry of ledger) {
    if (edgesByFrom.has(ledgerEntry.from)) {
      throw new RenameLedgerError(
        "ledger-duplicate-edge",
        `rename ledger has two outgoing edges from '${ledgerEntry.from}' — the closure must be functional (one current name per old reference)`,
        ".changelog/renames.yaml",
      );
    }
    edgesByFrom.set(ledgerEntry.from, ledgerEntry);
  }
  return edgesByFrom;
}

interface WalkRenameChainArgs {
  startReference: string;
  edgesByFrom: Map<string, Rename>;
}

function walkRenameChain(args: WalkRenameChainArgs): string {
  const { startReference, edgesByFrom } = args;
  const visited = new Set<string>([startReference]);
  let currentNode = startReference;
  // The reflexive-transitive closure: follow edges until a node has no
  // outgoing edge, returning that node. A revisited node means a cycle.
  while (true) {
    const nextEdge = edgesByFrom.get(currentNode);
    if (nextEdge === undefined) return currentNode;
    if (visited.has(nextEdge.to)) {
      throw new RenameLedgerError(
        "ledger-cycle",
        `rename ledger has a cycle: '${nextEdge.to}' was already visited starting from '${startReference}'`,
        ".changelog/renames.yaml",
      );
    }
    visited.add(nextEdge.to);
    currentNode = nextEdge.to;
  }
}
