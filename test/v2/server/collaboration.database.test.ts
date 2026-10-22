import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CommentRecord,
  CommentsResponse,
  ContextResponse,
  PublishResponse,
  SaveResponse,
} from "../../../src/server/af-api-contracts.ts";
import { page, startServer } from "../support/server.ts";
import { readStateFragment } from "../../../src/apollo/state-url.ts";

test("comments live on six-character page IDs and context shows what the commenter saw", async () => {
  const server = await startServer();
  try {
    const token = await server.token("owner@example.test");
    const published = (await (
      await server.request("/api/publish", { token, body: { source: page("<h1>Plan</h1>"), requestId: "comments" } })
    ).json()) as PublishResponse;
    const nodeId = /<h1 data-af-id="([^"]+)">/.exec(published.source)?.[1];
    assert.ok(nodeId);
    const created = await server.request(`/api/files/${published.id}/comments`, {
      token,
      body: { comment: { nodeId, quote: "Plan", body: "Rename this", state: { todos: [], filter: "done", draft: "Milk" } } },
    });
    assert.equal(created.status, 201);
    const comment = (await created.json()) as CommentRecord;
    assert.equal(comment.nodeId, nodeId);
    assert.equal(comment.version, 1);
    assert.equal(comment.resolved, false);

    // The page moves on; the comment's context still shows version 1.
    await server.request(`/api/files/${published.id}/source`, {
      method: "PUT",
      token,
      body: { source: published.source.replace("Plan</h1>", "Roadmap</h1>") },
      headers: { "If-Match": "1" },
    }).then((r) => r.json() as Promise<SaveResponse>);
    const list = (await (await server.request(`/api/files/${published.id}/comments`, { token })).json()) as CommentsResponse;
    assert.equal(list.head, 2);
    assert.deepEqual(list.comments.map((c) => c.id), [comment.id]);
    const context = (await (await server.request(`/api/files/${published.id}/context/${comment.id}`, { token })).json()) as ContextResponse;
    assert.equal(context.comment.id, comment.id);
    assert.equal(context.source, published.source);
    assert.deepEqual(context.state, { todos: [], filter: "done", draft: "Milk" }, "the commenter's own filter and draft");
    assert.ok(context.url !== null);
    assert.ok(context.url.startsWith(published.url + "#af-state="), context.url);
    const read = readStateFragment(new URL(context.url).hash);
    assert.deepEqual(read.state, context.state, "opening the url loads exactly that state");
    const plain = (await (
      await server.request(`/api/files/${published.id}/comments`, { token, body: { comment: { nodeId: null, quote: "", body: "No state" } } })
    ).json()) as CommentRecord;
    const bare = (await (await server.request(`/api/files/${published.id}/context/${plain.id}`, { token })).json()) as ContextResponse;
    assert.equal(bare.url, published.url, "without saved state the url is the plain address");

    const resolve = (revision: number) =>
      server.request(`/api/files/${published.id}/comments/${comment.id}`, {
        method: "PUT",
        token,
        body: { resolved: true },
        headers: { "If-Match": String(revision) },
      });
    const resolved = await resolve(comment.revision);
    assert.equal(resolved.status, 200);
    assert.equal(((await resolved.json()) as CommentRecord).resolved, true);
    assert.equal((await resolve(comment.revision)).status, 409);
  } finally {
    await server.close();
  }
});

test("sharing and paths work on six-character IDs", async () => {
  const server = await startServer();
  try {
    const token = await server.token("owner2@example.test");
    const published = (await (
      await server.request("/api/publish", {
        token,
        body: { source: page("<p>Shared</p>"), requestId: "sharing", path: "notes/shared", visibility: "private" },
      })
    ).json()) as PublishResponse;
    assert.equal(published.path, "notes/shared");
    const sharing = await server.request(`/api/files/${published.id}/sharing`, { token });
    assert.equal(sharing.status, 200);
    const current = (await sharing.json()) as { policy: { version: number; visibility: string }; url: string };
    assert.equal(current.policy.visibility, "private");
    assert.equal(current.url, published.url);
    const changed = await server.request(`/api/files/${published.id}/sharing`, {
      method: "PUT",
      token,
      body: { linkRole: "commenter" },
      headers: { "If-Match": String(current.policy.version) },
    });
    assert.equal(changed.status, 200);
    const stranger = await server.token("stranger@example.test");
    assert.ok([403, 404].includes((await server.request(`/api/files/${published.id}/source`, { token: stranger })).status));
    const { entries } = (await (await server.request("/api/paths", { token })).json()) as {
      entries: { path: string; url?: string }[];
    };
    assert.deepEqual(entries.find((e) => e.path === "notes/shared")?.url, published.url);
    // The documented move body renames the page; its ID and address stay.
    const moved = await server.request("/api/paths", { token, body: { kind: "move", from: "notes/shared", path: "notes/renamed" } });
    assert.equal(moved.status, 200);
    const after = ((await moved.json()) as { entries: { path: string; fileId: string | null; url?: string }[] }).entries;
    assert.deepEqual(after.find((e) => e.fileId === published.id)?.path, "notes/renamed");
    assert.equal(after.find((e) => e.path === "notes/renamed")?.url, published.url);
    assert.equal((await server.request("/api/paths", { token, body: { id: published.id, path: "x" } })).status, 422, "an unknown operation is refused");
  } finally {
    await server.close();
  }
});
