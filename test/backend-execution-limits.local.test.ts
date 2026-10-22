/**
 * The execution service's admission and frame bounds
 * (src/backend/execution-service.ts): a full service answers 503, which the
 * client reports as backend_busy and which clears when a slot frees; a reply
 * past maxFrameBytes is output_quota; a request past the service's frame
 * limit or a capability exchange past maxFrames is backend_rejected, and the
 * host's work is aborted when that happens mid-run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createExecutionService, remoteBackendHost } from "../src/backend/execution-service.ts";
import { BackendHostError, type BackendHost } from "../src/backend/contracts.ts";

const secret = "b".repeat(48);
const principal = { tenant: "t", subject: "s" };

async function fixture(host: BackendHost, service: Record<string, unknown> = {}, client: Record<string, unknown> = {}) {
  const listener = createExecutionService({ host, secret, ...service });
  const server = createServer(listener);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return {
    client: remoteBackendHost({ endpoint: `http://127.0.0.1:${address.port}/v1/execute`, secret, ...client }),
    close: async () => {
      await listener.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
const invoke = (client: BackendHost, extra: Record<string, unknown> = {}) =>
  client.invoke({
    deployment: {} as never,
    principal,
    input: { field: "x", args: null },
    env: {},
    reuse: { kind: "one-shot" },
    ...extra,
  } as never);
const code = async (work: Promise<unknown>) => {
  try {
    await work;
    return "resolved";
  } catch (error) {
    assert.ok(error instanceof BackendHostError, String(error));
    return error.code;
  }
};

test("a full service answers 503, reported as backend_busy, and admits again once a slot frees", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let started!: () => void;
  const running = new Promise<void>((r) => (started = r));
  let invocations = 0;
  const f = await fixture(
    {
      compile: async () => {
        throw Error();
      },
      invoke: async () => {
        invocations++;
        started();
        await gate;
        return "done";
      },
    },
    { maxConcurrent: 1 },
  );
  try {
    const first = invoke(f.client);
    await running;
    assert.equal(await code(invoke(f.client)), "backend_busy");
    assert.equal(invocations, 1, "the refused request never reached the host");
    release();
    assert.equal(await first, "done");
    assert.equal(await invoke(f.client), "done", "a freed slot admits the next request");
    assert.equal(invocations, 2);
  } finally {
    await f.close();
  }
});

test("a reply past maxFrameBytes is output_quota, and a smaller reply on the same service is delivered", async () => {
  const f = await fixture(
    {
      compile: async () => {
        throw Error();
      },
      invoke: async ({ input }) => "x".repeat((input as { args: number }).args),
    },
    { maxFrameBytes: 2000 },
  );
  try {
    assert.equal(await code(invoke(f.client, { input: { field: "x", args: 5000 } })), "output_quota");
    assert.equal(await invoke(f.client, { input: { field: "x", args: 100 } }), "x".repeat(100));
  } finally {
    await f.close();
  }
});

test("a request past the service's frame limit is backend_rejected before the host sees it", async () => {
  let invocations = 0;
  const f = await fixture(
    {
      compile: async () => {
        throw Error();
      },
      invoke: async () => {
        invocations++;
        return "ran";
      },
    },
    { maxFrameBytes: 2000 },
    { maxFrameBytes: 1_000_000 },
  );
  try {
    assert.equal(await code(invoke(f.client, { input: { field: "x", args: "y".repeat(5000) } })), "backend_rejected");
    assert.equal(invocations, 0);
    assert.equal(await invoke(f.client), "ran", "a fitting request on the same service runs");
  } finally {
    await f.close();
  }
});

test("a capability exchange past maxFrames is backend_rejected and aborts the host's work", async () => {
  let aborted = false;
  let answered = 0;
  const f = await fixture(
    {
      compile: async () => {
        throw Error();
      },
      invoke: async ({ signal, capabilityHandler }) => {
        signal!.addEventListener("abort", () => (aborted = true), { once: true });
        for (let i = 0; i < 10; i++) {
          await capabilityHandler!(principal, { kind: "invoke", resource: "db", operation: "read", input: i } as never, signal!);
          answered++;
        }
        return "finished";
      },
    },
    { maxFrames: 3 },
  );
  try {
    const result = await code(invoke(f.client, { capabilityHandler: async (_p: unknown, r: { input: number }) => r.input }));
    assert.equal(result, "backend_rejected");
    assert.ok(answered < 10, `the exchange stopped after ${answered} answers`);
    for (let i = 0; i < 50 && !aborted; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(aborted, true, "the host's signal fired");
  } finally {
    await f.close();
  }
});
