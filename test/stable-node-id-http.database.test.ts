import test from "node:test";
import assert from "node:assert/strict";
import { startServer, page } from "./v2/support/server.ts";
import { STABLE_NODE_ID_MAX_BYTES } from "../src/domain/stable-node-id-contracts.ts";

test("HTTP comments retain long and prototype-looking IDs and reject oversized or malformed IDs", async () => {
  const server = await startServer();
  try {
    const token = await server.token("node-id@example.test");
    const publication = await server.request("/api/publish", {
      token,
      body: {
        source: page("<p>Text</p>"),
        requestId: crypto.randomUUID(),
        visibility: "private",
      },
    });
    assert.equal(publication.status, 201);
    const { id } = await publication.json();
    const valid = [
      "x".repeat(342),
      "a".repeat(STABLE_NODE_ID_MAX_BYTES),
      "🙂".repeat(STABLE_NODE_ID_MAX_BYTES / 4),
      "__proto__",
      "constructor",
      "prototype",
    ];
    for (const nodeId of valid) {
      const response = await server.request(`/api/files/${id}/comments`, {
        token,
        body: { comment: { nodeId, body: "Comment", quote: "Text" } },
      });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).nodeId, nodeId);
    }
    for (const nodeId of [
      "a".repeat(STABLE_NODE_ID_MAX_BYTES + 1),
      "🙂".repeat(STABLE_NODE_ID_MAX_BYTES / 4) + "a",
      "\ud800",
      "a\0b",
      "",
    ]) {
      const response = await server.request(`/api/files/${id}/comments`, {
        token,
        body: { comment: { nodeId, body: "Comment" } },
      });
      assert.equal(response.status, 422);
    }
    const comments = await (
      await server.request(`/api/files/${id}/comments`, { token })
    ).json();
    assert.deepEqual(
      new Set(comments.comments.map((c: any) => c.nodeId)),
      new Set(valid),
    );
  } finally {
    await server.close();
  }
});
