import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { serveDatasetAttachments } from "../src/server/dataset-attachment-http.ts";
import type { DatasetAttachmentHttpPorts } from "../src/server/dataset-attachment-http-contracts.ts";
test("dedicated binary route captures trusted scope, preserves raw bytes and private download headers", async () => {
  let received = 0;
  const ports: DatasetAttachmentHttpPorts = {
    resolve: async (input) => ({
      backendId: "Back12",
      backendVersion: "a".repeat(64),
      pageId: input.pageId,
      backendNamespace: input.backendNamespace,
      bindingName: input.bindingName,
      subject: "actor",
      credentialHash: "private",
    }),
    service: {
      availability: async () => ({ canAttempt: false }),
      upload: async (c, u) => {
        assert.equal(c.subject, "actor");
        assert.equal(u.filename, "photo.png");
        for await (const chunk of u.body) received += chunk.length;
        return {
          ref: "dfile:" + "a".repeat(32),
          url: "/fixed",
          name: "photo.png",
          contentType: "image/png",
          size: received,
        };
      },
      read: async () => ({
        record: {
          id: "a".repeat(32),
          sourceNamespace: "legacy",
          datasetId: "data",
          pageId: "Page12",
          object: {
            sha256: "b".repeat(64),
            storageKey: "b".repeat(64),
            byteLength: 3,
            contentType: "image/png",
            filename: "photo.png",
          },
        },
        body: (async function* () {
          yield Buffer.from([1, 2, 3]);
        })(),
        close: async () => {},
      }),
    },
  };
  const server = createServer((req, res) => {
    void serveDatasetAttachments(
      req,
      res,
      new URL(req.url!, "http://127.0.0.1"),
      ports,
      "private",
    ).catch(() => res.destroy());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const root = `http://127.0.0.1:${address.port}/api/files/Page12/dataset-attachments/legacyData/images`;
  try {
    const response = await fetch(root, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Filename": "photo.png",
        "Idempotency-Key": "request_123",
      },
      body: new Uint8Array(1048577),
    });
    assert.equal(response.status, 200);
    assert.equal(received, 1048577);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const read = await fetch(root + "/" + "a".repeat(32));
    assert.equal(read.status, 200);
    assert.deepEqual(
      new Uint8Array(await read.arrayBuffer()),
      new Uint8Array([1, 2, 3]),
    );
    assert.match(read.headers.get("content-security-policy")!, /sandbox/);
    const denied = await fetch(root, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        Origin: "https://external.invalid",
      },
      body: new Uint8Array(3),
    });
    assert.equal(denied.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
