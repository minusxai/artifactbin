import test from "node:test";
import assert from "node:assert/strict";
import { compileProgramResolver } from "../src/migration/programs/compiler.ts";
const manifest = {
  values: ["region"],
  queries: ["total"],
  mutations: ["insert"],
  defaults: { region: "initial" },
};
async function load(script: string) {
  const plan = await compileProgramResolver(script, manifest);
  const module = await import(
    "data:text/javascript;base64," + Buffer.from(plan.source).toString("base64")
  );
  return { plan, run: module.default.Mutation.run };
}
test("headless resolver preserves page bindings, JSON, and fresh module state", async () => {
  const script = `import {signal,query,mutation} from 'page';let calls=0;const [region,setRegion]=signal('$region');const total=query('$total');const insert=mutation('$insert');export default async input=>{calls++;setRegion(input.region);const before=await total.ready;await insert({amount:input.amount});return {calls,before,after:await total.ready};}`;
  const { plan, run } = await load(script);
  const operations: string[] = [];
  let amount = 0;
  const caps = {
    invoke: async ({ operation, input }: any) => {
      operations.push(operation);
      if (operation === "query")
        return [{ region: input.values.region, amount }];
      if (operation === "mutate") {
        amount += input.args.amount;
        return null;
      }
      return null;
    },
  };
  const first = JSON.parse(
    await run(
      { inputJson: JSON.stringify({ region: "南", amount: 2 }) },
      null,
      caps,
    ),
  );
  assert.deepEqual(first, {
    calls: 1,
    before: [{ region: "南", amount: 0 }],
    after: [{ region: "南", amount: 2 }],
  });
  const second = JSON.parse(
    await run(
      { inputJson: JSON.stringify({ region: "next", amount: 3 }) },
      null,
      caps,
    ),
  );
  assert.equal(second.calls, 1);
  assert.equal(operations.filter((x) => x === "mutate").length, 2);
  assert.equal(plan.activation, "not-activated");
  assert.equal(plan.reuse, "one-shot");
  assert.deepEqual(await compileProgramResolver(script, manifest), plan);
});
test("offline admission rejects undeclared bindings and host/module capabilities", async () => {
  for (const script of [
    `import {query} from 'page';export default()=>query('$missing')`,
    `export default()=>fetch('https://example.test')`,
    `export default()=>import('page')`,
    `import fs from 'node:fs';export default()=>fs`,
    `import {query} from 'page';const q=query;export default()=>q('$total')`,
  ])
    await assert.rejects(compileProgramResolver(script, manifest));
});
test("resolver rejects non-JSON output and closes after handler error without retrying a write", async () => {
  const { run } = await load(
    `import {mutation} from 'page';const put=mutation('$insert');export default async()=>{await put({amount:1});throw Error('handler failed');}`,
  );
  let writes = 0;
  const caps = {
    invoke: async ({ operation }: any) => {
      if (operation === "mutate") writes++;
      return null;
    },
  };
  await assert.rejects(
    run({ inputJson: "null" }, null, caps),
    /handler failed/,
  );
  assert.equal(writes, 1);
  const invalid = await load("export default()=>({value:undefined})");
  await assert.rejects(
    invalid.run({ inputJson: "null" }, null, caps),
    /Cannot store/,
  );
});
