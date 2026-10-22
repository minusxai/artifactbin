import test from "node:test";
import assert from "node:assert/strict";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { createSandboxCall } from "../src/backend/sandbox-protocol.ts";
const context = {
  backendId: "backend",
  backendVersion: "revision",
  pageId: "page",
  subject: "user",
};
const input = {
  operation: "rename",
  requestId: "request_0123456789",
  params: { label: "new" },
};
test("dataset mutation capability binds saved server context and denies mismatched principal or absent service", async () => {
  let calls = 0;
  const result = { affected: 1, rowCount: 2, version: 3, generation: 1 };
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
      mutate: async (actual, request, signal) => {
        assert.deepEqual(actual, context);
        assert.deepEqual(request, input);
        assert.ok(signal);
        calls++;
        return result;
      },
    },
  );
  assert.deepEqual(
    await handler(
      { tenant: "page", subject: "user" },
      { kind: "dataset", operation: "mutate", input },
      new AbortController().signal,
    ),
    result,
  );
  await assert.rejects(
    handler(
      { tenant: "other", subject: "user" },
      { kind: "dataset", operation: "mutate", input },
      new AbortController().signal,
    ),
  );
  const absent = datasetCapabilityHandler(
    {
      read: async () => {
        throw Error("not read");
      },
    },
    context,
    async () => {
      throw Error("not connector");
    },
  );
  await assert.rejects(
    absent(
      { tenant: "page", subject: "user" },
      { kind: "dataset", operation: "mutate", input },
      new AbortController().signal,
    ),
  );
  assert.equal(calls, 1);
});
test("sandbox admits only named mutation requests and rejects SQL, authority and malformed parameters before dispatch", async () => {
  for (const extra of [
    {},
    { sql: "DELETE FROM rows" },
    { subject: "forged" },
    { backendId: "forged" },
    { params: { _me__id: "forged" } },
    { params: { x: { nested: true } } },
  ]) {
    let calls = 0;
    const failures: string[] = [];
    const call = createSandboxCall({
      principal: { tenant: "page", subject: "user" },
      signal: new AbortController().signal,
      handler: async (_principal, request) => {
        assert.equal(request.kind, "dataset");
        calls++;
        return null;
      },
      reply() {},
      result() {},
      failure(error) {
        failures.push(error.code);
      },
    });
    call.receive(
      Buffer.from(
        JSON.stringify({
          kind: "capability",
          id: 1,
          request: {
            kind: "dataset",
            operation: "mutate",
            input: { ...input, ...extra },
          },
        }),
      ),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(calls, Object.keys(extra).length ? 0 : 1);
    assert.equal(failures.length, Object.keys(extra).length ? 1 : 0);
    await call.close();
  }
});

test("only explicit definite mutation refusals become the trusted rejection marker", async () => {
  const { DatasetMutationError } = await import(
    "../src/datasets/mutation/contracts.ts"
  );
  const { BackendDatasetMutationRejectedError } = await import(
    "../src/backend/contracts.ts"
  );
  const handler = datasetCapabilityHandler(
    {
      read: async () => {
        throw Error();
      },
    },
    context,
    async () => null,
    {
      mutate: async () => {
        throw new DatasetMutationError("row_changed", "rejected");
      },
    },
  );
  await assert.rejects(
    handler(
      { tenant: "page", subject: "user" },
      { kind: "dataset", operation: "mutate", input },
      new AbortController().signal,
    ),
    BackendDatasetMutationRejectedError,
  );
});

test("an inflight mutation or unclassified failure remains unknown", async () => {
  const { DatasetMutationError } = await import(
    "../src/datasets/mutation/contracts.ts"
  );
  for (const code of ["inflight", "row_changed"]) {
    const failure = new DatasetMutationError(code);
    const handler = datasetCapabilityHandler(
      {
        read: async () => {
          throw Error();
        },
      },
      context,
      async () => null,
      {
        mutate: async () => {
          throw failure;
        },
      },
    );
    await assert.rejects(
      handler(
        { tenant: "page", subject: "user" },
        { kind: "dataset", operation: "mutate", input },
        new AbortController().signal,
      ),
      (error) => error === failure,
    );
  }
});
