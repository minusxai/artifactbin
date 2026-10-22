import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { planVizRecipePage } from "../src/migration/viz-pages/plan.ts";
import { convertVizRecipePage } from "../src/migration/viz-pages/convert.ts";
import { checkPage } from "../src/page/page-model.ts";
import type { VizRecipePageInput } from "../src/migration/viz-pages/contracts.ts";
const recipe = () => ({
  description: "Reusable chart template",
  engine: "vega-lite",
  bindings: [{ name: "x", label: "Category", accepts: ["nominal"] }],
  template: {
    mark: "bar",
    encoding: { x: { field: "{{x}}", type: "{{x:kind}}" } },
  },
});
const input = (value: unknown = recipe()): VizRecipePageInput => {
  const source = JSON.stringify(value, null, 2);
  return {
    format: "viz",
    title: "Chart recipe",
    coreUrl: "/af/v1/core.js",
    source,
    sourceVersion: 3,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
  };
};
test("viz recipe plan preserves original JSON text and immutable provenance", () => {
  const i = input();
  i.source = i.source.replaceAll("\n", "\r\n") + "\r\n";
  i.sourceSha256 = createHash("sha256").update(i.source).digest("hex");
  const plan = planVizRecipePage(i);
  assert.equal(plan.source, i.source);
  assert.deepEqual(plan.provenance, {
    format: "viz",
    sourceVersion: 3,
    sourceSha256: i.sourceSha256,
  });
});
test("recipe admission refuses malformed schema tokens and inconsistent archived provenance", () => {
  const bad = [
    { ...recipe(), engine: "javascript" },
    { ...recipe(), bindings: [] },
    { ...recipe(), template: { mark: "{{unknown}}" } },
    { ...recipe(), bindings: [{ name: "x", label: "X", accepts: ["html"] }] },
    { ...recipe(), bindings: [...recipe().bindings, ...recipe().bindings] },
    { ...recipe(), params: [{ name: "x", label: "duplicate" }] },
  ];
  for (const r of bad) assert.throws(() => planVizRecipePage(input(r)));
  for (const patch of [
    { format: "markup" },
    { sourceSha256: "a".repeat(64) },
    { sourceVersion: 0 },
    { source: '{"broken"' },
    { coreUrl: "https://example.com/core.js" },
  ])
    assert.throws(() =>
      planVizRecipePage({ ...input(), ...patch } as VizRecipePageInput),
    );
});
test("param and multi-slot templates remain reusable recipes without invented chart data", () => {
  const r = {
    ...recipe(),
    bindings: [
      {
        name: "fields",
        label: "Columns",
        accepts: ["quantitative"],
        multi: true,
      },
    ],
    params: [{ name: "heading", label: "Heading", default: "Counts" }],
    template: { title: "{{heading}}", transform: [{ fold: "{{fields}}" }] },
  };
  assert.equal(planVizRecipePage(input(r)).slots[0]?.multi, true);
  const result = convertVizRecipePage(input(r));
  assert.equal(result.classification, "functional");
  assert.doesNotMatch(
    result.html!,
    /vega-embed|af-backend|sourceQuery|sample data|unavailable/,
  );
});
test("ordinary HTML safely displays recipes with stable identities and exact copy/download source", () => {
  const r = recipe();
  r.description = "</script><img src=x onerror=alert(1)> café";
  r.bindings[0]!.label = "<Category>";
  const i = input(r);
  i.source += "\r\n";
  i.sourceSha256 = createHash("sha256").update(i.source).digest("hex");
  const converted = convertVizRecipePage(i);
  assert.deepEqual(checkPage(converted.html!), []);
  assert.equal((converted.html!.match(/<script\b/g) || []).length, 2);
  assert.match(converted.html!, /&lt;Category&gt;/);
  const literal = /const recipeSource=(.*);/.exec(converted.html!)?.[1];
  assert.ok(literal);
  assert.equal(JSON.parse(literal), i.source);
  assert.equal(
    Buffer.from(JSON.parse(literal), "utf8").equals(
      Buffer.from(i.source, "utf8"),
    ),
    true,
  );
  assert.match(converted.html!, /clipboard.writeText\(recipeSource\)/);
  assert.match(converted.html!, /new Blob\(\[recipeSource\]/);
  assert.equal(converted.identities["viz-recipe-source"], "viz-recipe-source");
  assert.deepEqual(converted.vizRecipeProvenance, {
    format: "viz",
    sourceVersion: i.sourceVersion,
    sourceSha256: i.sourceSha256,
  });
});
