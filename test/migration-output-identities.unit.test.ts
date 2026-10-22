import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCompiledOutputIdentities as reconcile } from "../src/migration/conversion/compiled/output-identities.ts";
const base = {
  ids: ["generated", "generated", "generated--af-occurrence-2"],
  sourceOwned: new Set<string>(),
  source: "<Markdown/>",
  htmlReferences: '<strong id="">A</strong><strong id="">B</strong><p id=""/>',
  javascript: "void 0;",
  css: "",
};
test("compiler-only unreferenced duplicate nodes acquire deterministic distinct identities", () => {
  assert.deepEqual(reconcile(base), [
    "generated",
    "generated--af-occurrence-3",
    "generated--af-occurrence-2",
  ]);
  assert.deepEqual(reconcile(base), reconcile(base));
});
test("source-owned or referenced duplicate identities remain refused", () => {
  for (const change of [
    { sourceOwned: new Set(["generated"]) },
    { source: '<p id="generated"/>' },
    { javascript: 'document.getElementById("generated")' },
    { css: "#generated{color:red}" },
    { htmlReferences: base.htmlReferences + '<a href="#generated">go</a>' },
  ])
    assert.equal(reconcile({ ...base, ...change }), null);
});
test("prototype output repairs compiler duplicates while strict and authored duplicates remain refused", async () => {
  const { admitLocalSource } = await import(
    "../src/migration/conversion/compiled/source-admission.ts"
  );
  const { admitLocalOutput } = await import(
    "../src/migration/conversion/compiled/local-output.ts"
  );
  const input = {
    source: '<p id="authored">Hello</p>',
    coreUrl: "/af/v1/core.js",
  };
  const prototype = admitLocalSource(input, "offline-prototype"),
    strict = admitLocalSource(input);
  assert.ok(prototype.ok && strict.ok);
  const output = {
    html: '<p id="authored">Hello</p><strong id="generated">A</strong><strong id="generated">B</strong>',
    css: "",
    title: "Example",
    build: "fixture",
    rootAttributes: {},
    modules: [],
    javascript: "void 0;",
    declarations: [],
  };
  const result = admitLocalOutput(prototype.plan, output);
  assert.ok(result.ok);
  assert.equal(new Set(Object.keys(result.value.identities)).size, 3);
  assert.match(result.value.body, /id="generated--af-occurrence-2"/);
  assert.equal(admitLocalOutput(strict.plan, output).ok, false);
  const repairedFormatting = admitLocalOutput(prototype.plan, {
    ...output,
    html: '<p><strong id="generated">One<div>Two</div>Three</p>',
  });
  assert.ok(repairedFormatting.ok);
  assert.ok(Object.keys(repairedFormatting.value.identities).length > 1);
  assert.equal(
    admitLocalOutput(prototype.plan, {
      ...output,
      html: output.html + '<p id="authored">Again</p>',
    }).ok,
    false,
  );
});
