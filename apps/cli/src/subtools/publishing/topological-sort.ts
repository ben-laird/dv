// Topological sort over the intra-workspace dependency graph the
// `get-dependencies` plugin op exposes. Used by `dv release` so
// dependent packages publish *after* the packages they depend on —
// JSR (and most registries) resolve manifest imports at publish
// time and fail if the dep version isn't visible yet.
//
// Pure function: takes a node list + an adjacency map and returns
// a topologically-sorted permutation, or signals a cycle. No
// I/O. Easy to property-test.
//
// Stability: when the graph permits multiple valid orderings (e.g.
// two leaf packages with no edges), the result preserves the input
// order. Ties are broken by *input position*, not alphabetically —
// the caller decides what counts as "default ordering" and we just
// preserve that decision.

export interface TopologicalSortArgs<TNode> {
  // Nodes in their default order. Ties break to this order when
  // the graph leaves a choice.
  nodes: TNode[];
  // Extracts the comparable identity of a node — typically the
  // package name. Two nodes with the same identity are illegal
  // (caller's responsibility to dedupe upstream).
  identityOf: (node: TNode) => string;
  // For each node, return the identities of nodes it depends on.
  // Returned identities not in `nodes` are silently ignored (we
  // only care about intra-workspace edges).
  dependenciesOf: (node: TNode) => readonly string[];
}

export type TopologicalSortResult<TNode> =
  | { kind: "ok"; ordered: TNode[] }
  | {
      kind: "cycle";
      // Identities of nodes participating in a cycle. Reported in
      // arbitrary order; the caller renders them.
      cyclicMembers: string[];
    };

// Returns nodes such that for every edge (A → B) where A depends
// on B, B appears before A in the result. Kahn's algorithm: pick
// a node with no remaining incoming edges, emit it, remove its
// outgoing edges, repeat. Ties broken by original input position
// so the result is deterministic.
export function topologicalSort<TNode>(
  args: TopologicalSortArgs<TNode>,
): TopologicalSortResult<TNode> {
  const { nodes, identityOf, dependenciesOf } = args;
  // Index by identity for lookup. Caller is responsible for unique
  // identities; we don't dedupe.
  const nodesByIdentity = new Map<string, TNode>();
  const nodeOrdinal = new Map<string, number>();
  for (const [position, node] of nodes.entries()) {
    const identity = identityOf(node);
    nodesByIdentity.set(identity, node);
    nodeOrdinal.set(identity, position);
  }
  // Build the reverse-edge index: for each node, the set of nodes
  // that depend on it. Used to find newly-eligible nodes when one
  // is emitted.
  //
  // Why reverse? We're emitting in dep-first order. A node is
  // emittable when its remaining-dep-count hits zero. After
  // emitting it, we decrement the counter of every node that
  // depended on it — those are its reverse edges.
  const reverseEdges = new Map<string, string[]>();
  const remainingDepCount = new Map<string, number>();
  for (const node of nodes) {
    const identity = identityOf(node);
    const directDeps = dependenciesOf(node);
    // Filter to deps that are actually nodes in this graph.
    // External deps (registry packages we don't release) are
    // silently dropped — they don't affect the release order.
    const intraGraphDeps = directDeps.filter((depIdentity) =>
      nodesByIdentity.has(depIdentity),
    );
    remainingDepCount.set(identity, intraGraphDeps.length);
    for (const depIdentity of intraGraphDeps) {
      const dependents = reverseEdges.get(depIdentity) ?? [];
      dependents.push(identity);
      reverseEdges.set(depIdentity, dependents);
    }
  }

  // Priority queue keyed by original ordinal. We poll the
  // lowest-ordinal node whose remaining-dep-count is 0. Since N
  // is small (workspace sizes are tens, not thousands), a sorted
  // array is the right data structure.
  const ready: string[] = [];
  for (const identity of nodesByIdentity.keys()) {
    if (remainingDepCount.get(identity) === 0) ready.push(identity);
  }
  // Sort ready[] by ordinal so ties break to input order.
  ready.sort(
    (leftIdentity, rightIdentity) =>
      (nodeOrdinal.get(leftIdentity) ?? 0) -
      (nodeOrdinal.get(rightIdentity) ?? 0),
  );

  const ordered: TNode[] = [];
  while (ready.length > 0) {
    const nextIdentity = ready.shift();
    if (nextIdentity === undefined) break;
    const nextNode = nodesByIdentity.get(nextIdentity);
    if (nextNode === undefined) continue;
    ordered.push(nextNode);
    // Decrement remaining-dep-count for every node that depended
    // on this one; promote to ready when it hits zero.
    const dependents = reverseEdges.get(nextIdentity) ?? [];
    for (const dependentIdentity of dependents) {
      const newCount = (remainingDepCount.get(dependentIdentity) ?? 0) - 1;
      remainingDepCount.set(dependentIdentity, newCount);
      if (newCount === 0) {
        // Insert at the position that preserves ordinal order.
        const insertOrdinal = nodeOrdinal.get(dependentIdentity) ?? 0;
        let insertAt = 0;
        while (
          insertAt < ready.length &&
          (nodeOrdinal.get(ready[insertAt] ?? "") ?? 0) <= insertOrdinal
        ) {
          insertAt += 1;
        }
        ready.splice(insertAt, 0, dependentIdentity);
      }
    }
  }

  if (ordered.length === nodes.length) {
    return { kind: "ok", ordered };
  }

  // A node with remaining deps > 0 that's not in `ordered` means
  // it's in a cycle (or downstream of one). Report every such
  // identity for the caller's error message.
  const cyclicMembers: string[] = [];
  for (const identity of nodesByIdentity.keys()) {
    if ((remainingDepCount.get(identity) ?? 0) > 0) {
      cyclicMembers.push(identity);
    }
  }
  return { kind: "cycle", cyclicMembers };
}
