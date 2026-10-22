import test from "node:test";
import assert from "node:assert/strict";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { createSandboxCall } from "../src/backend/sandbox-protocol.ts";
const context = {
  backendId: "backend",
  backendVersion: "revision",
  pageId: "page",
  subject: "viewer",
};
const input = { valueName: "selectedPerson", userId: "selected-user" };
const card = { name: "Selected person", handle: null, image: null };
test("person capability captures authority and fails closed without matching principal and service", async () => {
  let calls = 0;
  const reads = {
    read: async () => {
      throw Error("not read");
    },
  };
  const fallback = async () => {
    throw Error("not connector");
  };
  const person = {
    person: async (actual: typeof context, request: unknown) => {
      assert.deepEqual(actual, context);
      assert.deepEqual(request, input);
      calls++;
      return card;
    },
  };
  const handler = datasetCapabilityHandler(
    reads,
    context,
    fallback,
    undefined,
    undefined,
    person,
  );
  const request = { kind: "dataset", operation: "person", input } as const;
  const signal = new AbortController().signal;
  assert.deepEqual(
    await handler({ tenant: "page", subject: "viewer" }, request, signal),
    card,
  );
  for (const principal of [
    { tenant: "other", subject: "viewer" },
    { tenant: "page", subject: "other" },
  ])
    await assert.rejects(handler(principal, request, signal));
  await assert.rejects(
    datasetCapabilityHandler(reads, context, fallback)(
      { tenant: "page", subject: "viewer" },
      request,
      signal,
    ),
  );
  assert.equal(calls, 1);
});
test("person protocol only forwards the selected registered value and requested user ID", async () => {
  for (const changed of [
    {},
    { pageId: "other" },
    { sourceNamespace: "other" },
    { column: "secret" },
    { email: "private" },
    { userId: "" },
    { valueName: "constructor" },
    { userId: "x".repeat(16385) },
  ]) {
    let calls = 0;
    const errors: string[] = [];
    const call = createSandboxCall({
      principal: { tenant: "page", subject: "viewer" },
      signal: new AbortController().signal,
      handler: async (_p, request) => {
        assert.deepEqual(request, {
          kind: "dataset",
          operation: "person",
          input,
        });
        calls++;
        return card;
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
            operation: "person",
            input: { ...input, ...changed },
          },
        }),
      ),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(calls, Object.keys(changed).length ? 0 : 1);
    assert.equal(errors.length, Object.keys(changed).length ? 1 : 0);
    await call.close();
  }
});
