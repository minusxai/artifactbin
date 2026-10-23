import test from "node:test";
import assert from "node:assert/strict";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { createSandboxCall } from "../src/backend/sandbox-protocol.ts";
const context = {
  backendId: "back",
  backendVersion: "v1",
  pageId: "page",
  subject: "viewer",
};
const input = { name: "items", column: "owner" };
test("user choices capture exact host authority and fail closed without service", async () => {
  const reads = {
      read: async () => {
        throw Error("unused");
      },
    },
    fallback = async () => {
      throw Error("unused");
    };
  let calls = 0;
  const handler = datasetCapabilityHandler(
    reads,
    context,
    fallback,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      userChoices: async (actual, request) => {
        assert.deepEqual(actual, context);
        assert.deepEqual(request, input);
        calls++;
        return [{ value: "member", label: "Member" }];
      },
    },
  );
  const request = { kind: "dataset", operation: "userChoices", input } as const,
    signal = new AbortController().signal;
  assert.deepEqual(
    await handler({ tenant: "page", subject: "viewer" }, request, signal),
    [{ value: "member", label: "Member" }],
  );
  await assert.rejects(
    handler({ tenant: "other", subject: "viewer" }, request, signal),
  );
  await assert.rejects(
    handler({ tenant: "page", subject: "other" }, request, signal),
  );
  await assert.rejects(
    datasetCapabilityHandler(reads, context, fallback)(
      { tenant: "page", subject: "viewer" },
      request,
      signal,
    ),
  );
  assert.equal(calls, 1);
});
test("sandbox cannot supply document, table, user or version authority", async () => {
  for (const extra of [
    {},
    { sourceNamespace: "other" },
    { ref: "ref:scope" },
    { version: 2 },
    { table: "private" },
    { userId: "someone" },
  ]) {
    let calls = 0;
    const errors: string[] = [];
    const call = createSandboxCall({
      principal: { tenant: "page", subject: "viewer" },
      signal: new AbortController().signal,
      handler: async (_p, req) => {
        calls++;
        assert.deepEqual(req, {
          kind: "dataset",
          operation: "userChoices",
          input,
        });
        return [];
      },
      reply() {},
      result() {},
      failure(error) {
        errors.push(error.code);
      },
    });
    call.receive(
      Buffer.from(
        JSON.stringify({
          kind: "capability",
          id: 1,
          request: {
            kind: "dataset",
            operation: "userChoices",
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
