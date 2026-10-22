import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../src/backend/container-host.ts";
import { compileLegacyServerModule } from "../src/migration/server-module.ts";

test("offline legacy server factory executes only through the backend isolate with invocation-local module state", async () => {
  const compiled = await compileLegacyServerModule(
    'let count=0;export default async function(input){if(input.fail)throw Error("handler failed");return {input,count:++count}}',
    { values: [], queries: [], mutations: [] },
  );
  const host = createBackendHost({ sandboxNetwork: "none" });
  try {
    const deployment = await host.compile(
      `export const typeDefs='scalar Json\\ntype Query {invoke(input:Json):Json}';const factory=${compiled.factorySource};export default {Query:{invoke:async({input})=>factory({})(input)}};`,
    );
    const invoke = (input: { value?: number; fail?: boolean }) =>
      host.invoke({
        deployment,
        principal: { tenant: "page", subject: null },
        input: { field: "invoke", args: { input } },
        env: {},
        reuse: { kind: "one-shot" },
      });
    assert.deepEqual(await invoke({ value: 1 }), {
      input: { value: 1 },
      count: 1,
    });
    assert.deepEqual(await invoke({ value: 2 }), {
      input: { value: 2 },
      count: 1,
    });
    await assert.rejects(invoke({ fail: true }));
  } finally {
    await host.close?.();
  }
});
