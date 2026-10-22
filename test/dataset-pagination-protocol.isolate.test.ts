import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createBackendHost } from "../src/backend/container-host.ts";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { createDatasetReadService } from "../src/datasets/service.ts";
import type {
  DatasetResolvedBinding,
  DatasetReadAuthority,
} from "../src/datasets/contracts.ts";
test("real entry preserves second-page pins and the read service refuses changed snapshots before row I/O", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  try {
    const deployment = await host.compile(
      `export const typeDefs='type Query {run:String!}';export default {Query:{run:async(_args,_principal,caps)=>{const args={binding:'sales',schema:'public',table:'rows',offset:0,limit:1};const first=await caps.dataset.read(args);const next=await caps.dataset.read({...args,offset:first.nextOffset,expectedVersion:first.version,expectedGeneration:first.generation});return JSON.stringify([first.rows,next.rows]);}}};`,
    );
    const context = {
      backendId: "backend",
      backendVersion: deployment.version,
      pageId: "page",
      subject: null,
    };
    const bytes = Buffer.from('[{"n":1},{"n":2}]'),
      sha = createHash("sha256").update(bytes).digest("hex");
    const owner = { userId: "owner", tokenId: null };
    for (const change of ["none", "version", "generation"]) {
      let calls = 0,
        loads = 0,
        version = 1,
        generation = 1;
      const service = createDatasetReadService({
        binding: async () => {
          if (calls++ > 0) {
            if (change === "version") version = 2;
            if (change === "generation") generation = 2;
          }
          return {
            mode: "live",
            name: "sales",
            backendId: "backend",
            backendVersion: deployment.version,
            page: { id: "page", version: 1, legacyId: "page", editId: "edit" },
            dataset: { id: "dataset", version, policyRevision: 0 },
            revision: { version, generation, policyRevision: 0 },
            tables: [
              {
                schema: "public",
                name: "rows",
                columns: [{ name: "n", type: "number" }],
                object: { key: sha, sha256: sha, bytes: bytes.length },
              },
            ],
          } satisfies DatasetResolvedBinding;
        },
        authority: async () =>
          ({
            pageVersion: 1,
            page: {
              id: "page",
              editId: "edit",
              owner,
              visibility: "public",
              format: "markup",
              deleted: false,
              ownerIsTestUser: false,
              acceptedJoinUserIds: [],
            },
            dataset: {
              id: "dataset",
              owner,
              visibility: "public",
              version,
              generation,
              policyRevision: 0,
              deleted: false,
              ownerIsTestUser: false,
              policy: null,
            },
            facts: {
              caller: { userId: null, tokenId: null },
              identity: null,
              groupRoles: {},
              sharedArtifactIds: [],
            },
          }) satisfies DatasetReadAuthority,
        read: async () => {
          loads++;
          return (async function* () {
            yield bytes;
          })();
        },
      });
      const invoke = () =>
        host.invoke({
          deployment,
          principal: { tenant: "page", subject: null },
          input: { field: "run", args: {} },
          env: {},
          reuse: { kind: "one-shot" },
          capabilityHandler: datasetCapabilityHandler(
            service,
            context,
            async () => {
              throw Error("denied");
            },
          ),
        });
      if (change === "none") {
        assert.deepEqual(JSON.parse((await invoke()) as string), [
          [{ n: 1 }],
          [{ n: 2 }],
        ]);
        assert.equal(loads, 2);
      } else {
        await assert.rejects(invoke(), { code: "dataset_changed" });
        assert.equal(loads, 1);
      }
      assert.equal(calls, 2);
    }
  } finally {
    await host.close?.();
  }
});
