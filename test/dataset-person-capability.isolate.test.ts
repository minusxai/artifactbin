import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../src/backend/container-host.ts";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { BackendDatasetMutationRejectedError } from "../src/backend/contracts.ts";
test("real isolate person capability has exact selected-value input and read-only effect accounting", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  try {
    const deployment = await host.compile(
      `export const typeDefs='type Query {run(mode:String!):String}';export default {Query:{run:async({mode},p,caps)=>{const input={valueName:'selectedPerson',userId:'selected-user'};if(mode==='forged')input.pageId='other';const person=await caps.dataset.person(input);if(mode==='refused')await caps.dataset.mutate({operation:'save',requestId:'person_request_00001',params:{}});return JSON.stringify(person);}}};`,
    );
    const context = {
      backendId: "backend",
      backendVersion: deployment.version,
      pageId: "page",
      subject: "viewer",
    };
    const card = { name: "Selected person", handle: null, image: null };
    let calls = 0;
    const handler = datasetCapabilityHandler(
      {
        read: async () => {
          throw Error("not read");
        },
      },
      context,
      async () => {
        throw Error("not connector");
      },
      {
        mutate: async () => {
          throw new BackendDatasetMutationRejectedError();
        },
      },
      undefined,
      {
        person: async (actual, input) => {
          assert.deepEqual(actual, context);
          assert.deepEqual(input, {
            valueName: "selectedPerson",
            userId: "selected-user",
          });
          calls++;
          return card;
        },
      },
    );
    const invoke = (mode: string) =>
      host.invoke({
        deployment,
        principal: { tenant: "page", subject: "viewer" },
        input: { field: "run", args: { mode } },
        env: {},
        reuse: { kind: "one-shot" },
        capabilityHandler: handler,
      });
    assert.deepEqual(JSON.parse((await invoke("read")) as string), card);
    await assert.rejects(invoke("forged"), { code: "backend_rejected" });
    assert.equal(calls, 1);
    await assert.rejects(invoke("refused"), {
      code: "dataset_mutation_rejected",
    });
    assert.equal(calls, 2);
  } finally {
    await host.close?.();
  }
});
