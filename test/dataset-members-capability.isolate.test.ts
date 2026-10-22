import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../src/backend/container-host.ts";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { BackendDatasetMutationRejectedError } from "../src/backend/contracts.ts";
test("real isolate members calls have no authority arguments and do not count as mutation effects", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  try {
    const deployment = await host.compile(
      `export const typeDefs='type Query {run(mode:String!):String}';export default {Query:{run:async({mode},p,caps)=>{if(mode==='forged')return caps.dataset.members({pageId:'other'});const snapshot=await caps.dataset.members();if(mode==='refused')await caps.dataset.mutate({operation:'save',requestId:'members_request_0001',params:{}});return JSON.stringify(snapshot);}}};`,
    );
    const context = {
      backendId: "backend",
      backendVersion: deployment.version,
      pageId: "page",
      subject: "viewer",
    };
    let calls = 0;
    const snapshot = {
      generation: "a".repeat(64),
      rows: [{ user_id: "member", joined_at: "2026-01-01T00:00:00.000Z" }],
    };
    const capabilities = datasetCapabilityHandler(
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
      {
        members: async (actual) => {
          assert.deepEqual(actual, context);
          calls++;
          return snapshot;
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
        capabilityHandler: capabilities,
      });
    assert.deepEqual(JSON.parse((await invoke("read")) as string), snapshot);
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
