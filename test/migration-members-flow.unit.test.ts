import test from "node:test";
import assert from "node:assert/strict";
import { prepareLocalFlow } from "../src/migration/conversion/compiled/local-engine.ts";
const binding = {
  backendNamespace: "legacyData",
  backendHref: "/af/v1/ids/Abcd12",
};
const raw = { imports: [], values: [], queries: [{ name: "members" }] };
const archive = (builtin: string) => async () => ({
  prepareCompile: async () => ({}),
  compileDataflow: () => ({
    ok: true,
    compiled: {
      values: [],
      imports: [],
      mutations: [],
      queries: [
        { name: "members", engine: "sqlite", reads: { builtins: [builtin] } },
      ],
    },
  }),
});
test("current-page members compile without Imports but never capture memberships in HTML", async () => {
  const result = await prepareLocalFlow(
    archive("_members"),
    raw,
    [],
    {},
    {},
    [],
    [],
    binding,
  );
  assert.deepEqual(result.results, { tables: {}, errors: {} });
  assert.deepEqual(result.flow.queries[0].reads.builtins, ["_members"]);
  await assert.rejects(
    prepareLocalFlow(archive("_members"), raw, [], {}, {}, [], []),
  );
  for (const builtin of ["_me", "_me.id", "_now", "_tz"])
    await assert.rejects(
      prepareLocalFlow(archive(builtin), raw, [], {}, {}, [], [], binding),
    );
  for (const invalid of [
    { ...binding, backendNamespace: "other" },
    { ...binding, backendHref: "https://example.invalid" },
    { ...binding, pageId: "arbitrary" },
  ])
    await assert.rejects(
      prepareLocalFlow(archive("_members"), raw, [], {}, {}, [], [], invalid),
    );
});
test('offline prototype keeps an unused validated service binding without granting another scope',async()=>{
 const archived=async()=>({prepareCompile:async()=>({}),compileDataflow:()=>({ok:true,compiled:{values:[],imports:[],mutations:[],queries:[{name:'members',engine:'sqlite',reads:{builtins:[]}}]}})});
 await assert.rejects(prepareLocalFlow(archived,raw,[],{},{},[],[],binding));
 const result=await prepareLocalFlow(archived,raw,[],{},{},[],[],binding,undefined,'offline-prototype');assert.deepEqual(result.results,{tables:{},errors:{}});
 await assert.rejects(prepareLocalFlow(archived,raw,[],{},{},[],[],{...binding,backendHref:'https://example.invalid'},undefined,'offline-prototype'));
});
