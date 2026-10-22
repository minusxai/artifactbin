import test from "node:test";
import assert from "node:assert/strict";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { createSandboxCall } from "../src/backend/sandbox-protocol.ts";
test("advisory capability binds caller authority, forwards cancellation and rejects unowned request fields", async () => {
  const context = {
    backendId: "backend",
    backendVersion: "revision",
    pageId: "page",
    subject: "viewer",
  };
  let calls = 0;
  const signal = new AbortController().signal;
  const reads = {
    read: async () => {
      throw Error();
    },
  };
  const fallback = async () => {
    throw Error();
  };
  const availability = {
    mutationAvailability: async (
      actual: typeof context,
      input: unknown,
      received?: AbortSignal,
    ) => {
      assert.deepEqual(actual, context);
      assert.deepEqual(input, { operation: "save" });
      assert.equal(received, signal);
      calls++;
      return { canAttempt: true };
    },
  };
  const handler = datasetCapabilityHandler(
    reads,
    context,
    fallback,
    undefined,
    undefined,
    undefined,
    undefined,
    availability,
  );
  const request = {
    kind: "dataset",
    operation: "mutationAvailability",
    input: { operation: "save" },
  } as const;
  assert.deepEqual(
    await handler({ tenant: "page", subject: "viewer" }, request, signal),
    { canAttempt: true },
  );
  await assert.rejects(
    handler({ tenant: "page", subject: "other" }, request, signal),
  );
  assert.equal(calls, 1);
  for (const input of [
    { operation: "save" },
    { operation: "save", subject: "forged" },
    { operation: "constructor" },
    {},
  ]) {
    let accepted = 0,
      failed = 0;
    const call = createSandboxCall({
      principal: { tenant: "page", subject: "viewer" },
      signal,
      handler: async () => {
        accepted++;
        return { canAttempt: false };
      },
      reply() {},
      result() {},
      failure() {
        failed++;
      },
    });
    call.receive(
      Buffer.from(
        JSON.stringify({
          kind: "capability",
          id: 1,
          request: { ...request, input },
        }),
      ),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(
      accepted,
      Object.keys(input).length === 1 && input.operation === "save" ? 1 : 0,
    );
    assert.equal(failed, accepted ? 0 : 1);
    await call.close();
  }
});
