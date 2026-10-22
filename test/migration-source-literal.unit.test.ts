import { test } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "acorn";
import { readSourceLiteral } from "../src/migration/conversion/compiled/source-literal.ts";
import { controlLiteral } from "../src/migration/conversion/compiled/data-controls.ts";
import { readLocalSourceManifest } from "../src/migration/conversion/compiled/source-manifest.ts";
import { admitLocalSource } from "../src/migration/conversion/compiled/source-admission.ts";
const expression = (text: string) =>
  Parser.parseExpressionAt(text, 0, { ecmaVersion: "latest" });
test("source literals share signed numeric and static template semantics", () => {
  for (const text of ["-2", "+2", "-0", "`ready`", "[1,{2:-3}]"])
    assert.deepEqual(
      controlLiteral(expression(text)),
      readSourceLiteral(expression(text)),
    );
  assert.equal(
    readLocalSourceManifest('<Value name="n" type="number" default={-2}/>')
      .declarations[0]!.default,
    controlLiteral(expression("-2")),
  );
  assert.equal(controlLiteral(null), true);
});
test("literal decoding rejects executable, ambiguous and non JSON syntax", () => {
  for (const text of [
    "f()",
    "NaN",
    "1e999",
    "/x/",
    "1n",
    "[,,]",
    "({...x})",
    "({get x(){return 1}})",
    "({x:1,x:2})",
    "({__proto__:1})",
    "`x${1}`",
  ])
    assert.throws(() => readSourceLiteral(expression(text)), text);
});
test("literal decoding enforces explicit tree budgets", () => {
  assert.throws(() => readSourceLiteral(expression("[[1]]"), { maxDepth: 1 }));
  assert.throws(() => readSourceLiteral(expression("[1,2]"), { maxNodes: 2 }));
  assert.deepEqual(
    readSourceLiteral(expression("[1,2]"), { maxNodes: 3 }),
    [1, 2],
  );
});

test("negative Slider bounds remain literal through full source admission", () => {
  const result = admitLocalSource({
    source:
      '<Helmet><Value name="n" type="number" default={0}/></Helmet><Slider value="$n" min={-2} max={2}/>',
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(result.ok, true);
});
