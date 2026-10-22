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
const snapshot = {
  generation: "a".repeat(64),
  rows: [{ user_id: "member", joined_at: "2026-01-01T00:00:00.000Z" }],
};
test("members capability captures authority and fails closed without service or matching principal", async () => {
  let calls = 0;
  const reads = {
    read: async () => {
      throw Error("not read");
    },
  };
  const fallback = async () => {
    throw Error("not connector");
  };
  const members = {
    members: async (actual: typeof context) => {
      assert.deepEqual(actual, context);
      calls++;
      return snapshot;
    },
  };
  const handler = datasetCapabilityHandler(
    reads,
    context,
    fallback,
    undefined,
    members,
  );
  const request = { kind: "dataset", operation: "members" } as const;
  const signal = new AbortController().signal;
  assert.deepEqual(
    await handler({ tenant: "page", subject: "viewer" }, request, signal),
    snapshot,
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
test("members protocol accepts no caller authority or arguments", async () => {
  for (const extra of [
    {},
    { input: {} },
    { pageId: "other" },
    { subject: "other" },
    { source: "other" },
  ]) {
    let calls = 0;
    const failures: string[] = [];
    const call = createSandboxCall({
      principal: { tenant: "page", subject: "viewer" },
      signal: new AbortController().signal,
      handler: async (_p, request) => {
        assert.deepEqual(request, { kind: "dataset", operation: "members" });
        calls++;
        return snapshot;
      },
      reply() {},
      result() {},
      failure(e) {
        failures.push(e.code);
      },
    });
    call.receive(
      Buffer.from(
        JSON.stringify({
          kind: "capability",
          id: 1,
          request: { kind: "dataset", operation: "members", ...extra },
        }),
      ),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(calls, Object.keys(extra).length ? 0 : 1);
    assert.equal(failures.length, Object.keys(extra).length ? 1 : 0);
    await call.close();
  }
});
