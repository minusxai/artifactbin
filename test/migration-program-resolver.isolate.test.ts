import test from "node:test";
import assert from "node:assert/strict";
import { compileProgramResolver } from "../src/migration/programs/compiler.ts";
import { programCapabilityHandler } from "../src/migration/programs/capability.ts";
import { createBackendHost } from "../src/backend/container-host.ts";
test("headless page resolver executes through the isolated backend and trusted capabilities", async () => {
  const manifest = {
    values: ["region"],
    queries: ["total"],
    mutations: ["insert"],
    defaults: { region: "initial" },
  };
  const plan = await compileProgramResolver(
    `import {signal,query,mutation} from 'page';const [region,setRegion]=signal('$region');const total=query('$total');const insert=mutation('$insert');export default async input=>{setRegion(input.region);await insert({amount:input.amount});return {region:region(),rows:await total.ready};}`,
    manifest,
  );
  const principal = { tenant: "page", subject: "caller" };
  let amount = 0;
  const handler = programCapabilityHandler({
    principal,
    requestId: "run",
    manifest,
    transport: {
      authorize: async () => {},
      query: async (_name, values) => [
        { region: String(values.region), amount },
      ],
      mutate: async (_name, args) => {
        amount += Number(args.amount);
      },
    },
  });
  const host = createBackendHost();
  try {
    const deployment = await host.compile(plan.source);
    const output = await host.invoke({
      deployment,
      principal,
      input: {
        field: "run",
        args: { inputJson: JSON.stringify({ region: "south", amount: 4 }) },
      },
      env: {},
      reuse: { kind: "one-shot" },
      capabilityHandler: handler,
    });
    assert.equal(typeof output, "string");
    assert.deepEqual(JSON.parse(output as string), {
      region: "south",
      rows: [{ region: "south", amount: 4 }],
    });
  } finally {
    await host.close?.();
  }
});
