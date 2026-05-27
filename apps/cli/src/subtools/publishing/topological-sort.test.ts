import { assertEquals } from "@std/assert";
import { topologicalSort } from "./topological-sort.ts";

// Pure-function tests for the dep-graph sort used by `dv release`
// to order publishes. Given/When/Then per CONVENTIONS.md.

interface FakeNode {
  name: string;
  dependsOn: string[];
}

function fakeDepsOf(node: FakeNode): readonly string[] {
  return node.dependsOn;
}
function fakeIdentityOf(node: FakeNode): string {
  return node.name;
}

Deno.test("topologicalSort returns the input order when there are no edges", () => {
  // Given three independent nodes
  const nodes: FakeNode[] = [
    { name: "a", dependsOn: [] },
    { name: "b", dependsOn: [] },
    { name: "c", dependsOn: [] },
  ];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then the input order is preserved (ties broken by ordinal)
  assertEquals(result.kind, "ok");
  if (result.kind !== "ok") return;
  assertEquals(
    result.ordered.map((node) => node.name),
    ["a", "b", "c"],
  );
});

Deno.test("topologicalSort puts a dependency before its dependent", () => {
  // Given two nodes where dv depends on clipc
  // (clipc is in the workspace; dv references it via imports)
  const nodes: FakeNode[] = [
    { name: "dv", dependsOn: ["clipc"] },
    { name: "clipc", dependsOn: [] },
  ];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then clipc comes first, dv second — the publish-order fix
  // this whole exercise is about
  assertEquals(result.kind, "ok");
  if (result.kind !== "ok") return;
  assertEquals(
    result.ordered.map((node) => node.name),
    ["clipc", "dv"],
  );
});

Deno.test("topologicalSort handles a transitive chain a → b → c", () => {
  // Given a chain: a depends on b, b depends on c
  const nodes: FakeNode[] = [
    { name: "a", dependsOn: ["b"] },
    { name: "b", dependsOn: ["c"] },
    { name: "c", dependsOn: [] },
  ];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then deepest dep emits first
  assertEquals(result.kind, "ok");
  if (result.kind !== "ok") return;
  assertEquals(
    result.ordered.map((node) => node.name),
    ["c", "b", "a"],
  );
});

Deno.test("topologicalSort breaks ties by input order so output is byte-stable", () => {
  // Given two independent leaves followed by a node depending on both
  // The leaves were ordered b-then-a in the input even though
  // alphabetically a < b — preserving input order is the point
  const nodes: FakeNode[] = [
    { name: "root", dependsOn: ["b-leaf", "a-leaf"] },
    { name: "b-leaf", dependsOn: [] },
    { name: "a-leaf", dependsOn: [] },
  ];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then the two leaves come out in their input order (b before a)
  // and root comes last
  assertEquals(result.kind, "ok");
  if (result.kind !== "ok") return;
  assertEquals(
    result.ordered.map((node) => node.name),
    ["b-leaf", "a-leaf", "root"],
  );
});

Deno.test("topologicalSort ignores edges to nodes outside the input set (external deps)", () => {
  // Given a node depending on something that isn't in the workspace
  // (e.g. lodash, an external registry dep)
  const nodes: FakeNode[] = [
    { name: "mypkg", dependsOn: ["lodash", "@some/external"] },
  ];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then the external edges are silently dropped — they don't
  // block publishing and they don't appear in the output
  assertEquals(result.kind, "ok");
  if (result.kind !== "ok") return;
  assertEquals(
    result.ordered.map((node) => node.name),
    ["mypkg"],
  );
});

Deno.test("topologicalSort reports a cycle instead of silently dropping nodes", () => {
  // Given a two-node cycle: a depends on b, b depends on a
  const nodes: FakeNode[] = [
    { name: "a", dependsOn: ["b"] },
    { name: "b", dependsOn: ["a"] },
  ];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then a cycle is reported with both members
  assertEquals(result.kind, "cycle");
  if (result.kind !== "cycle") return;
  assertEquals(result.cyclicMembers.sort(), ["a", "b"]);
});

Deno.test("topologicalSort reports cycle membership even when an acyclic prefix exists", () => {
  // Given: independent leaf `clean`; two-node cycle a ↔ b
  const nodes: FakeNode[] = [
    { name: "clean", dependsOn: [] },
    { name: "a", dependsOn: ["b"] },
    { name: "b", dependsOn: ["a"] },
  ];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then we get a cycle report and the cyclic members named.
  // We do NOT emit a partial ordering: the API is total-or-cycle,
  // not best-effort.
  assertEquals(result.kind, "cycle");
  if (result.kind !== "cycle") return;
  assertEquals(result.cyclicMembers.sort(), ["a", "b"]);
});

Deno.test("topologicalSort over a single-node workspace returns it unchanged", () => {
  // Given the degenerate one-node case
  const nodes: FakeNode[] = [{ name: "alone", dependsOn: [] }];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then it round-trips
  assertEquals(result.kind, "ok");
  if (result.kind !== "ok") return;
  assertEquals(
    result.ordered.map((node) => node.name),
    ["alone"],
  );
});

Deno.test("topologicalSort handles a diamond: shared dep emits before either consumer", () => {
  // Given:    a
  //         /   \
  //        b     c
  //         \   /
  //           d   (shared dep)
  const nodes: FakeNode[] = [
    { name: "a", dependsOn: ["b", "c"] },
    { name: "b", dependsOn: ["d"] },
    { name: "c", dependsOn: ["d"] },
    { name: "d", dependsOn: [] },
  ];

  // When sorted
  const result = topologicalSort({
    nodes,
    identityOf: fakeIdentityOf,
    dependenciesOf: fakeDepsOf,
  });

  // Then d emits first, a emits last; b and c are
  // in input order between (b before c since b was first in input)
  assertEquals(result.kind, "ok");
  if (result.kind !== "ok") return;
  assertEquals(
    result.ordered.map((node) => node.name),
    ["d", "b", "c", "a"],
  );
});
