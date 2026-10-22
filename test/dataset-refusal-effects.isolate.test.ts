import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../src/backend/container-host.ts";
import { BackendDatasetMutationRejectedError } from "../src/backend/contracts.ts";
test("a dataset refusal proves field rejection only while it is the sole potential effect", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  try {
    const deployment = await host.compile(
      `export const typeDefs='type Query { run(mode:String!): String }';export default {Query:{run:async({mode},p,caps)=>{const refuse=()=>caps.dataset.mutate({operation:'save',requestId:'effect_request_0001',params:{}});const write=()=>caps.store.set({saved:true},{expected:0});if(mode==='before'){await write();await refuse();}if(mode==='after'){let error;try{await refuse();}catch(e){error=e;}await write();throw error;}if(mode==='parallel'){await Promise.all([refuse(),write()]);}await refuse();return 'unreachable';}}};`,
    );
    for (const mode of ["single", "before", "after", "parallel"]) {
      let writes = 0;
      await assert.rejects(
        host.invoke({
          deployment,
          principal: { tenant: "page", subject: "caller" },
          input: { field: "run", args: { mode } },
          env: {},
          reuse: { kind: "one-shot" },
          capabilityHandler: async (_principal, request) => {
            if (request.kind === "dataset")
              throw new BackendDatasetMutationRejectedError();
            if (request.kind === "store" && request.operation === "set") {
              writes++;
              return { version: 1 };
            }
            throw Error("denied");
          },
        }),
        {
          code:
            mode === "single"
              ? "dataset_mutation_rejected"
              : "backend_rejected",
        },
      );
      assert.equal(writes, mode === "single" ? 0 : 1);
    }
  } finally {
    await host.close?.();
  }
});

test("a caught refusal from an earlier warm invocation cannot classify a later write as rejected", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  try {
    const deployment = await host.compile(
      `let saved;export const typeDefs='type Query { run(mode:String!): String }';export default {Query:{run:async({mode},p,caps)=>{if(mode==='capture'){try{await caps.dataset.mutate({operation:'save',requestId:'warm_request_00001',params:{}});}catch(error){saved=error;}return 'captured';}await caps.store.set({saved:true},{expected:0});throw saved;}}};`,
    );
    let writes = 0;
    const invoke = (mode: string) =>
      host.invoke({
        deployment,
        principal: { tenant: "page", subject: "caller" },
        input: { field: "run", args: { mode } },
        env: {},
        reuse: { kind: "file", scope: { owner: "owner", fileId: "backend" } },
        capabilityHandler: async (_principal, request) => {
          if (request.kind === "dataset")
            throw new BackendDatasetMutationRejectedError();
          if (request.kind === "store" && request.operation === "set") {
            writes++;
            return { version: 1 };
          }
          throw Error();
        },
      });
    assert.equal(await invoke("capture"), "captured");
    await assert.rejects(invoke("write"), { code: "backend_rejected" });
    assert.equal(writes, 1);
  } finally {
    await host.close?.();
  }
});
