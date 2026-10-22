import { test } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { historicalSourceValueDeclaration } from "../../../src/migration/conversion/compiled/historical-bound-value.ts";
import { readLocalSourceManifest } from "../../../src/migration/conversion/compiled/source-manifest.ts";
const source = '<Value name="owner" source="ref:Dataset001" column="owner"/>';
const node = (source: string) =>
  Parser.extend(jsx()).parseExpressionAt(source, 0, { ecmaVersion: "latest" });
test("historical bound grammar yields only unavailable user/null without granting a dataset proof", () => {
  assert.deepEqual(historicalSourceValueDeclaration(node(source)), {
    name: "owner",
    type: "user",
    default: null,
  });
  assert.throws(() => readLocalSourceManifest(source));
  assert.deepEqual(
    readLocalSourceManifest(source, [], "historical-unavailable").declarations,
    [{ name: "owner", type: "user", default: null }],
  );
  assert.deepEqual(
    readLocalSourceManifest(
      source + '<Value name="count" type="number" default={2}/>',
      [],
      "historical-unavailable",
    ).declarations,
    [
      { name: "owner", type: "user", default: null },
      { name: "count", type: "number", default: 2 },
    ],
  );
});
test("historical bound placeholders refuse custom defaults, dynamic authority, malformed identities and duplicate names", () => {
  for (const text of [
    source.replace("/>", ' default="usr_other"/>'),
    source.replace("/>", ' type="user"/>'),
    source.replace("/>", " constraints={{self:true}}/>"),
    source.replace('"ref:Dataset001"', "{dynamicSource}"),
    source.replace('name="owner"', 'name="constructor"'),
    source.replace('column="owner"', 'column="__proto__"'),
    source.replace('"ref:Dataset001"', '"Dataset001"'),
    source.replace("/>", " {...dynamic}/>"),
  ])
    assert.throws(() => historicalSourceValueDeclaration(node(text)));
  assert.throws(() =>
    readLocalSourceManifest(source + source, [], "historical-unavailable"),
  );
});
