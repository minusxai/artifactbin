import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNativeRevision } from "./recover.ts";
import { nativeDigest } from "./selection.ts";
import type { NativeSelectedRevision } from "./contracts.ts";
function fixture(): NativeSelectedRevision {
  const document = {
    kind: "graph",
    schema: 3,
    claimedIds: { retired: 3 },
    nodes: {
      $root: { parent: null, parts: ["", ""], children: ["node"], ast: null },
      node: {
        parent: "$root",
        parts: ['<Value name="x"/>'],
        children: [],
        ast: {
          kind: "jsx",
          roots: [{ type: "element", isComponent: true, tag: "Value" }],
        },
      },
    },
  };
  return {
    key: { sourceNamespace: "synthetic", sourceId: "page", version: 4 },
    original: { version: 4, document },
    documentSha256: nativeDigest(document),
    rowSha256: "test",
    matchingArchives: [],
  };
}
test("recovers exact retained bytes, all graph identities and reservations without mutation", () => {
  const revision = fixture(),
    before = JSON.stringify(revision);
  const result = analyzeNativeRevision(revision);
  assert.equal(result.source, '<Value name="x"/>');
  assert.deepEqual(
    result.identities.map((n) => n.sourceNode),
    ["$root", "node"],
  );
  assert.equal(result.identities[1]?.sourceStart, 0);
  assert.equal(result.identities[1]?.sourceEnd, result.source.length);
  assert.deepEqual(result.claimedIds, { retired: 3 });
  assert.deepEqual(result.components, { Value: 1 });
  assert.equal(JSON.stringify(revision), before);
});
test("refuses missing, repeated, cyclic, disconnected or inconsistent-parent nodes and changed graph digest", () => {
  for (const mutate of [
    (g: any) => delete g.nodes.node,
    (g: any) => {
      g.nodes.$root.children = ["node", "node"];
      g.nodes.$root.parts = ["", "", ""];
    },
    (g: any) => {
      g.nodes.node.children = ["$root"];
      g.nodes.node.parts = ["", ""];
    },
    (g: any) => {
      g.nodes.orphan = { ...g.nodes.node };
    },
    (g: any) => {
      g.nodes.node.parent = "other";
    },
  ]) {
    const r = fixture();
    mutate(r.original.document);
    r.documentSha256 = nativeDigest(r.original.document);
    assert.throws(() => analyzeNativeRevision(r));
  }
  const r = fixture();
  r.documentSha256 = "changed";
  assert.throws(() => analyzeNativeRevision(r), /document_digest/);
});
test("never attempts partial or static fallback for malformed boundaries", () => {
  const r = fixture();
  (r.original.document as any).nodes.$root.parts = [];
  r.documentSha256 = nativeDigest(r.original.document);
  assert.throws(() => analyzeNativeRevision(r), /graph_recovery/);
});
test("admits only independently proved empty-separator repair and preserves original graph receipts", () => {
  const r = fixture();
  const g = r.original.document as any;
  g.nodes.$root.children = ["node", "next"];
  g.nodes.next = { parent: "$root", children: [], parts: ["text"], ast: null };
  r.documentSha256 = nativeDigest(g);
  const original = JSON.stringify(g);
  const oracle = {
    ownSource: () => "",
    canonicalSource: () => "proof",
    canonicalDocument: () => "proof",
  };
  // Retained repair requires a retained AST witness, not just two separators.
  assert.throws(() => analyzeNativeRevision(r, { oracle }), /graph_recovery/);
  g.nodes.$root.ast = { kind: "jsx", roots: [] };
  r.documentSha256 = nativeDigest(g);
  const result = analyzeNativeRevision(r, { oracle });
  assert.equal(result.recovery.kind, "proved-empty-separators");
  assert.equal(result.recovery.repairedNodes, 1);
  assert.equal(result.source, '<Value name="x"/>text');
  assert.equal((g.nodes.$root.parts as string[]).length, 2);
  assert.notEqual(JSON.stringify(g), original);
  const refusal = { ...oracle, canonicalSource: () => "not-equivalent" };
  assert.throws(
    () => analyzeNativeRevision(r, { oracle: refusal }),
    /graph_recovery/,
  );
});
