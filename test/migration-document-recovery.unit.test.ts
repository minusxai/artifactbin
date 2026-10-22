import test from "node:test";
import assert from "node:assert/strict";
import { recoverLegacyDocumentSource as recover } from "../src/migration/conversion/document-recovery.ts";
const graph = () => ({
  kind: "graph",
  schema: 3,
  nodes: {
    $root: { parts: ["", ""], children: ["wrapper"] },
    wrapper: {
      ast: { tag: "figure" },
      parts: ["<figure>", "</figure>"],
      children: ["a", "b"],
    },
    a: { parts: ["A"], children: [] },
    b: { parts: ["B"], children: [] },
  },
});
const oracle = {
  ownSource: () => "<figure></figure>",
  canonicalDocument: () => "<figure>AB</figure>",
  canonicalSource: (source: string) => source,
};
test("missing empty boundaries recover only with exact retained AST agreement and preserve original", () => {
  const original = graph(),
    before = JSON.stringify(original);
  assert.deepEqual(recover(original, oracle), {
    source: "<figure>AB</figure>",
    repairedNodes: 1,
  });
  assert.equal(JSON.stringify(original), before);
});
test("changed wrappers, changed semantic AST, ambiguous parts and cycles remain refused", () => {
  assert.equal(
    recover(graph(), { ...oracle, ownSource: () => "<aside></aside>" }),
    null,
  );
  assert.equal(
    recover(graph(), {
      ...oracle,
      canonicalDocument: () => "<figure>BA</figure>",
    }),
    null,
  );
  const bad = graph();
  bad.nodes.wrapper.parts = ["<figure>", "middle", "extra", "</figure>"];
  assert.equal(recover(bad, oracle), null);
  const cycle = graph();
  cycle.nodes.wrapper.children = ["wrapper", "b"];
  assert.equal(recover(cycle, oracle), null);
});
