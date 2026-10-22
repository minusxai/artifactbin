import test from "node:test";
import assert from "node:assert/strict";
import { startServer, page } from "../support/server.ts";
import type { CommentRecord } from "../../../src/server/af-api-contracts.ts";

test("thread route resolves an old resolved reply using current page authorization", async () => {
  const server = await startServer();
  try {
    const token = await server.token("owner@example.test"),
      stranger = await server.token("reader@example.test");
    const published = await (
      await server.request("/api/publish", {
        token,
        body: {
          source: page("<h1>Thread page</h1>"),
          requestId: "comment-links",
          visibility: "private",
        },
      })
    ).json();
    const base = `/api/files/${published.id}`;
    async function add(
      body: string,
      parentId: string | null = null,
    ): Promise<CommentRecord> {
      const response = await server.request(base + "/comments", {
        token,
        body: {
          comment: { body, nodeId: null, quote: "", parentId, version: 1 },
        },
      });
      assert.equal(response.status, 201, await response.clone().text());
      return response.json();
    }
    const root = await add("Old root"),
      reply = await add("Selected reply", root.id);
    await server.request(base + "/comments/" + root.id, {
      method: "PUT",
      token,
      headers: { "If-Match": "1" },
      body: { resolved: true },
    });
    for (let i = 0; i < 51; i++) await add("New thread " + i);
    const boot = await (
      await server.request(`/api/library/${published.id}/host`, { token })
    ).json();
    assert.equal(
      boot.state.comments.some((c: { id: string }) => c.id === reply.id),
      false,
    );
    const response = await server.request(
      base + "/comments/" + reply.id + "/thread",
      { token },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const thread = await response.json();
    assert.equal(thread.rootId, root.id);
    assert.equal(thread.selectedId, reply.id);
    assert.deepEqual(
      thread.comments.map((c: CommentRecord) => c.id),
      [root.id, reply.id],
    );
    assert.equal(thread.comments[0].resolved, true);
    assert.equal(
      (
        await server.request(base + "/comments/" + reply.id + "/thread", {
          token: stranger,
        })
      ).status,
      403,
    );
    assert.equal(
      (await server.request(base + "/comments/missing/thread", { token }))
        .status,
      404,
    );
    await server.query("UPDATE files SET deleted_at=1 WHERE id=$1", [
      published.id,
    ]);
    assert.equal(
      (
        await server.request(base + "/comments/" + reply.id + "/thread", {
          token,
        })
      ).status,
      404,
    );
  } finally {
    await server.close();
  }
});

test("thread route refuses oversized threads instead of silently returning partial context", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await (
      await server.request("/api/publish", {
        token,
        body: {
          source: page("<h1>Bounded thread</h1>"),
          requestId: "bounded-thread",
        },
      })
    ).json();
    const path = `/api/files/${published.id}/comments`;
    const root = await (
      await server.request(path, {
        token,
        body: {
          comment: { body: "Root", nodeId: null, quote: "", version: 1 },
        },
      })
    ).json();
    await server.query(
      `INSERT INTO comments(file_id,id,node_id,quote,body,source_revision,parent_id,app_state_id,published_by,created_at,revision,resolved,fingerprint,sequence) SELECT file_id,'reply-'||n,NULL,'','Reply',source_revision,id,NULL,published_by,created_at,1,false,'synthetic-'||n,sequence+n FROM comments CROSS JOIN generate_series(1,200) n WHERE file_id=$1 AND id=$2`,
      [published.id, root.id],
    );
    const response = await server.request(path + "/" + root.id + "/thread", {
      token,
    });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /too large/);
    await server.query("DELETE FROM comments WHERE file_id=$1 AND parent_id=$2",[published.id,root.id]);
    await server.query("UPDATE comments SET body=$3 WHERE file_id=$1 AND id=$2",[published.id,root.id,"x".repeat(1_000_001)]);
    assert.equal((await server.request(path+"/"+root.id+"/thread",{token})).status,413);
  } finally {
    await server.close();
  }
});
