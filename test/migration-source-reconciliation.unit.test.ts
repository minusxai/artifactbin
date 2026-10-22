import test from "node:test";
import assert from "node:assert/strict";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
import type { ArchivedLocalOutput } from "../src/migration/conversion/compiled/local-contracts.ts";
const input = {
  source:
    '<Helmet><Value name="count" type="number" default={2}/><Value name="rows" type="table" value={[{amount:1,label:"one"}]}/></Helmet><p>{$count}</p>',
  coreUrl: "/af/v1/core.js",
};
const output: ArchivedLocalOutput = {
  html: "<p>2</p>",
  css: "",
  title: "Example",
  build: "synthetic",
  rootAttributes: {},
  capabilities: [],
  javascript: "void 0;",
  modules: [],
  declarations: [
    { name: "count", type: "number", default: 2 },
    {
      name: "rows",
      type: "table",
      default: [{ amount: 1, label: "one" }],
      columns: [
        { name: "amount", type: "number" },
        { name: "label", type: "string" },
      ],
    },
  ],
};
test("compiler output cannot replace source-owned state types, defaults, table rows or column order", async () => {
  const good = await compileArchivedLocal(input, {
    compiler: { compile: async () => output },
  });
  assert.equal(good.classification, "functional");
  const table = output.declarations[1]!;
  for (const declarations of [
    [{ name: "count", type: "string", default: "2" }, table],
    [{ name: "count", type: "number", default: 3 }, table],
    [
      output.declarations[0],
      { ...table, default: [{ amount: 9, label: "changed" }] },
    ],
    [
      output.declarations[0],
      {
        ...table,
        columns: [
          { name: "label", type: "string" },
          { name: "amount", type: "number" },
        ],
      },
    ],
    [
      output.declarations[0],
      {
        name: "rows",
        type: "table",
        default: [{ amount: "1", label: "one" }],
        columns: [
          { name: "amount", type: "string" },
          { name: "label", type: "string" },
        ],
      },
    ],
    [output.declarations[0], null],
  ]) {
    const result = await compileArchivedLocal(input, {
      compiler: {
        compile: async () =>
          ({ ...output, declarations }) as ArchivedLocalOutput,
      },
    });
    assert.equal(result.classification, "manual-blocked");
    assert.equal(result.html, null);
    assert.equal(result.issues[0]?.code, "compiled-local-output");
  }
});
test("matching compiler declarations may reorder declarations and object keys without changing source semantics", async () => {
  const result = await compileArchivedLocal(input, {
    compiler: {
      compile: async () => ({
        ...output,
        declarations: [
          {
            ...output.declarations[1]!,
            default: [{ label: "one", amount: 1 }],
          },
          output.declarations[0]!,
        ] as ArchivedLocalOutput["declarations"],
      }),
    },
  });
  assert.equal(result.classification, "functional");
});

test("source-owned string defaults survive safe JSON-script packaging exactly", async () => {
  const value = "</script><span>literal</span>";
  const result = await compileArchivedLocal(
    {
      source:
        '<Value name="text" type="string" default={"</script><span>literal</span>"}/><p>{$text}</p>',
      coreUrl: "/af/v1/core.js",
    },
    {
      compiler: {
        compile: async () => ({
          ...output,
          declarations: [{ name: "text", type: "string", default: value }],
        }),
      },
    },
  );
  assert.equal(result.classification, "functional");
  const state = result.html!.match(/data-af="state">([^<]*)<\/script>/)?.[1];
  assert.ok(state);
  assert.equal(JSON.parse(state).compiledPage.text, value);
});


test("rendered source identities cannot disappear or change during compilation", async () => {
  const source = '<Value name="count" type="number" default={2}/><p id="stable">{$count}</p>';
  for (const html of ['<p id="replacement">2</p>', '<p>2</p>']) {
    const result = await compileArchivedLocal({source, coreUrl: input.coreUrl}, {
      compiler: {compile: async () => ({...output, html, declarations: [output.declarations[0]!]})},
    });
    assert.equal(result.classification, "manual-blocked");
    assert.equal(result.html, null);
  }
});

test("rendered identities are canonical even when compiler provenance conflicts", async () => {
  const result = await compileArchivedLocal({...input, source: input.source + '<span id="stable">text</span>'}, {
    compiler: {compile: async () => ({...output, html: '<p>2</p><span id="stable" data-af-id="wrong">text</span><i id="generated">extra</i>'})},
  });
  assert.equal(result.classification, "functional");
  assert.match(result.html!, /<span id="stable" data-af-id="stable">/);
  assert.doesNotMatch(result.html!, /data-af-id="wrong"/);
  assert.match(result.html!, /id="generated" data-af-id="generated"/);
});


test("duplicate authored identities refuse before invoking the compiler", async () => {
  let calls = 0;
  const result = await compileArchivedLocal({source: '<p id="same">one</p><span id="same">two</span>', coreUrl: input.coreUrl}, {
    compiler: {compile: async () => { calls++; return output; }},
  });
  assert.equal(result.classification, "manual-blocked");
  assert.equal(calls, 0);
});

test("conditional output preserves exactly the source-default branch identities", async () => {
  const source='<Value name="count" type="number" default={2}/>{$count === 2 ? <p id="active">yes</p> : <p id="inactive">no</p>}';
  for(const [html,classification] of [
    ['<p id="active">yes</p>','functional'],
    ['<p id="inactive">no</p>','manual-blocked'],
    ['<p id="active">yes</p><p id="inactive">no</p>','manual-blocked'],
  ]){
    const result=await compileArchivedLocal({source,coreUrl:input.coreUrl},{compiler:{compile:async()=>({...output,html:html!,declarations:[output.declarations[0]!]})}});
    assert.equal(result.classification,classification);
  }
});
