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

test("partial recovery preserves exact root sibling placement and marks unavailable content", async () => {
 const {recoverPartialLegacyDocument: partial}=await import('../src/migration/conversion/document-recovery.ts');
 const original={schema:3,kind:'graph',nodes:{$root:{parts:['','','',''],children:['a','missing','b']},a:{parts:['<p>A</p>'],children:[]},b:{parts:['<p>B</p>'],children:[]}}};
 const before=JSON.stringify(original);
 assert.deepEqual(partial(original),{source:'<p>A</p><p role="note">Original saved content unavailable</p><p>B</p>',missingNodes:1});
 assert.equal(JSON.stringify(original),before);
 assert.equal(partial({...original,nodes:{...original.nodes,a:{parts:['<div>','</div>'],children:['nested-missing']}}}),null);
 assert.equal(partial({...original,nodes:{...original.nodes,$root:{parts:['<script>','','','</script>'],children:['a','missing','b']}}}),null);
 assert.equal(partial({...original,nodes:{...original.nodes,a:{parts:['',''],children:['a']}}}),null);
});
