import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxCall } from "../src/backend/sandbox-protocol.ts";
import { withCapabilityAuthority } from "../src/backend/capability-authority.ts";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import type { BackendJson, CompiledBackend } from "../src/backend/contracts.ts";
const input = {
  binding: "sales",
  schema: "public",
  table: "rows",
  offset: 0,
  limit: 1,
};
const context = {
  backendId: "backend-file",
  backendVersion: "version",
  pageId: "document",
  subject: null,
};
const deployment = {
  version: "version",
  runtime: "workerd/esbuild/protocol@2/image:sha256:x",
} as CompiledBackend;
test("dataset frames admit only read windows and never caller authority or object keys", async () => {
  for (const extra of [{}, { objectKey: "dataset/x" }, { subject: "forged" }]) {
    let calls = 0;
    const errors: string[] = [];
    const replies: BackendJson[] = [];
    const call = createSandboxCall({
      principal: { tenant: "document", subject: null },
      signal: new AbortController().signal,
      handler: async () => {
        calls++;
        return null;
      },
      reply: (r) => {
        replies.push(r);
      },
      result: () => {},
      failure: (e) => {
        errors.push(e.code);
      },
    });
    call.receive(
      Buffer.from(
        JSON.stringify({
          kind: "capability",
          id: 1,
          request: {
            kind: "dataset",
            operation: "read",
            input: { ...input, ...extra },
          },
        }),
      ),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(calls, Object.keys(extra).length ? 0 : 1);
    assert.equal(errors.length, Object.keys(extra).length ? 1 : 0);
    await call.close();
  }
});
test("anonymous dataset reads reach trusted binding service while anonymous connectors remain denied", async () => {
  let datasetCalls = 0,
    connectorCalls = 0;
  const handler = datasetCapabilityHandler(
    {
      async read(actual, request) {
        assert.deepEqual(actual, context);
        assert.deepEqual(request, input);
        datasetCalls++;
        return {
          version: 1,
          generation: 1,
          schema: "public",
          table: "rows",
          columns: [],
          rows: [],
          offset: 0,
          nextOffset: null,
          totalRows: 0,
        };
      },
    },
    context,
    async () => null,
  );
  const host = withCapabilityAuthority(
    {
      compile: async () => deployment,
      async invoke(r) {
        const call = async (q: unknown) => {
          try {
            return await r.capabilityHandler!(
              r.principal,
              q as never,
              new AbortController().signal,
            );
          } catch {
            return "denied";
          }
        };
        return [
          await call({ kind: "dataset", operation: "read", input }),
          await call({
            kind: "invoke",
            resource: "db",
            operation: "list",
            input: null,
          }),
        ];
      },
    },
    {
      grants: [],
      host: {
        invoke: async () => {
          connectorCalls++;
          return null;
        },
        transaction: async () => [],
        close: async () => {},
      },
    } as never,
  );
  const result = await host.invoke({
    deployment,
    principal: { tenant: "document", subject: null },
    input: { field: "rows", args: null },
    capabilityHandler: handler,
    env: {},
    reuse: { kind: "one-shot" },
  });
  assert.equal((result as unknown[])[1], "denied");
  assert.equal(datasetCalls, 1);
  assert.equal(connectorCalls, 0);
  await host.close();
});
test("existing page GraphQL route injects captured dataset authority into a linked backend field", async () => {
  const { createBackendRoutes } = await import("../src/backend/af-files.ts");
  const { sealDeployment, BACKEND_RUNTIME } = await import(
    "../src/backend/deployment.ts"
  );
  const typeDefs = "type Query { count: Int! }";
  const compiled = sealDeployment("export default {};", "bundle", {
    typeDefs,
    fields: ["count"],
    runtime: BACKEND_RUNTIME,
  });
  const pageId = "Page12",
    backendId = "Back12";
  let reads = 0;
  const database = {
    async transaction<T>(
      work: (
        client: import("../src/backend/af-backend-contracts.ts").SqlClient,
      ) => Promise<T>,
    ): Promise<T> {
      return work({
        async query(text) {
          assert.match(text, /FROM af_backend_pages/);
          return {
            rows: [
              {
                name: "data",
                file_id: backendId,
                version: compiled.version,
                type_defs: typeDefs,
                deployment: compiled,
                owner: "owner",
              },
            ],
            rowCount: 1,
          };
        },
      });
    },
  };
  const routes = createBackendRoutes({
    database,
    caller: async () => ({ pageId, subject: null, role: "VIEWER" }),
    datasets: {
      async read(actual, request) {
        assert.deepEqual(actual, {
          backendId,
          backendVersion: compiled.version,
          pageId,
          subject: null,
        });
        assert.deepEqual(request, input);
        reads++;
        return {
          version: 2,
          generation: 1,
          schema: "public",
          table: "rows",
          columns: [],
          rows: [],
          offset: 0,
          nextOffset: null,
          totalRows: 7,
        };
      },
    },
    host: {
      compile: async () => compiled,
      async invoke(r) {
        const window = await r.capabilityHandler!(
          r.principal,
          { kind: "dataset", operation: "read", input },
          r.signal ?? new AbortController().signal,
        );
        return (window as { totalRows: number }).totalRows;
      },
    },
    log: () => {},
  });
  const response = await routes.handle({
    method: "POST",
    url: new URL("http://example.test/api/files/" + pageId + "/graphql"),
    credential: "",
    body: { query: "query { data { count } }" },
    signal: new AbortController().signal,
  });
  assert.equal(response?.status, 200);
  assert.equal(reads, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(response?.body)), {
    data: { data: { count: 7 } },
  });
});

test("reserved program binding capabilities reach only the invocation handler, including anonymous readers", async () => {
  let connectorCalls = 0,
    programCalls = 0;
  const host = withCapabilityAuthority(
    {
      compile: async () => deployment,
      invoke: async (request) =>
        request.capabilityHandler!(
          request.principal,
          {
            kind: "invoke",
            resource: "program-bindings",
            operation: "authorize",
            input: {},
          },
          new AbortController().signal,
        ),
    },
    {
      grants: [],
      host: {
        invoke: async () => {
          connectorCalls++;
          return null;
        },
        transaction: async () => [],
        close: async () => {},
      },
    } as never,
  );
  const result = await host.invoke({
    deployment,
    principal: { tenant: "document", subject: null },
    input: { field: "run", args: null },
    env: {},
    reuse: { kind: "one-shot" },
    capabilityHandler: async () => {
      programCalls++;
      return "allowed";
    },
  });
  assert.equal(result, "allowed");
  assert.equal(programCalls, 1);
  assert.equal(connectorCalls, 0);
  await host.close();
});
