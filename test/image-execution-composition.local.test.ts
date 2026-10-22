import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createExecutionService } from "../src/backend/execution-service.ts";
test("composed image route authenticates independently and shutdown drains a partial upload", async () => {
  let calls = 0,
    closed = false;
  let started!: () => void;
  const began = new Promise<void>((r) => {
    started = r;
  });
  const service = createExecutionService({
    secret: "a".repeat(48),
    host: {
      compile: async () => {
        throw Error("backend route used");
      },
      invoke: async () => null,
    },
    imageProcessor: {
      async execute(input) {
        calls++;
        started();
        for await (const _ of input) {
        }
      },
      async close() {
        closed = true;
      },
    },
  });
  const server = createServer(service);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  try {
    const denied = await fetch(
      `http://127.0.0.1:${address.port}/v1/image-process`,
      { method: "POST", body: "x" },
    );
    assert.equal(denied.status, 401);
    assert.equal(calls, 0);
    const req = request({
      host: "127.0.0.1",
      port: address.port,
      path: "/v1/image-process",
      method: "POST",
      headers: {
        authorization: "Bearer " + "a".repeat(48),
        "content-length": "100",
      },
    });
    req.on("error", () => {});
    req.write("x");
    await began;
    await service.close();
    assert.equal(closed, true);
    assert.equal(calls, 1);
    req.destroy();
  } finally {
    await service.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
