import { testDatabase } from "./postgres.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService, addAccount } from "../src/server.js";
const source =
  '<!DOCTYPE html><html><head><title>T</title></head><body><h1 data-af-id="heading">Hello</h1></body></html>';
const collaborationRequest = {
  source,
  requestId: "one",
  visibility: "unlisted",
  linkRole: "commenter",
};
test("authenticated publish, document grants, durable comments and historical context", async () => {
  const dbOptions = await testDatabase();
  await addAccount(dbOptions, "alice", "correct horse battery");
  await addAccount(dbOptions, "bob", "second correct battery");
  let service = createService(dbOptions);
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  let origin = `http://127.0.0.1:${service.server.address().port}`;
  async function request(
    path,
    token,
    body,
    method = body ? "POST" : "GET",
    headers = {},
  ) {
    const r = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  }
  const login = async (username, password) =>
    (await request("/api/login", null, { username, password })).body.token;
  try {
    const alice = await login("alice", "correct horse battery");
    const bob = await login("bob", "second correct battery");
    assert.equal(
      (await request("/api/publish", null, collaborationRequest)).status,
      401,
    );
    const published = await request("/api/publish", alice, collaborationRequest);
    assert.equal(published.status, 201);
    const pub = published.body;
    const replay = await request("/api/publish", alice, collaborationRequest);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, pub);
    assert.equal(
      (
        await request("/api/publish", alice, {
          ...collaborationRequest,
          source: source.replace("Hello", "Changed"),
        })
      ).status,
      409,
      "a requestId names one publish",
    );
    const base = `/api/files/${pub.id}`;
    const scoped = (await request(`/api/library/${pub.id}/host`, bob)).body.boot
      .token;
    assert.equal(
      (
        await request(base + "/source", scoped, { source: "bad" }, "PUT", {
          "If-Match": "1",
        })
      ).status,
      403,
    );
    const comment = {
      nodeId: "heading",
      body: "Look here",
      quote: "Hello",
      state: { count: 3 },
    };
    const first = await request(base + "/comments", scoped, { comment });
    assert.equal(first.status, 201);
    assert.equal(first.body.author, "bob");
    assert.equal(first.body.version, 1);
    // Both writers saw revision 1: only one edit may commit.
    const edits = await Promise.all([
      request(base + `/comments/${first.body.id}`, alice, { body: "owner edit" }, "PUT", { "If-Match": "1" }),
      request(base + `/comments/${first.body.id}`, scoped, { body: "author edit" }, "PUT", { "If-Match": "1" }),
    ]);
    assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
    const many = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request(base + "/comments", i % 2 ? alice : scoped, { comment }),
      ),
    );
    assert.ok(many.every((r) => r.status === 201));
    const listed = (await request(base + "/comments", alice)).body;
    assert.equal(listed.comments.length, 13);
    assert.equal(new Set(listed.comments.map((c) => c.id)).size, 13);
    assert.equal(
      (
        await request(base + "/source", alice, { source: pub.source.replace("Hello", "Updated") }, "PUT", {
          "If-Match": "1",
        })
      ).status,
      200,
    );
    const stale = await request(base + "/source", alice, { source: "stale" }, "PUT", {
      "If-Match": "1",
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.version, 2);
    const context = (await request(base + `/context/${first.body.id}`, scoped)).body;
    assert.equal(context.source, pub.source);
    assert.deepEqual(context.state, { count: 3 });
    await new Promise((r) => service.server.close(r));
    await service.close();
    service = createService(dbOptions);
    await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${service.server.address().port}`;
    assert.deepEqual(
      (await request(base + `/context/${first.body.id}`, bob)).body.source,
      context.source,
    );
    assert.equal((await request(base + "/revoke", alice, {})).status, 200);
    assert.equal((await request(base + "/comments", scoped)).status, 403);
    assert.equal((await request(base + "/comments", bob)).status, 200, "the account's link role still reads");
  } finally {
    await new Promise((r) => service.server.close(r));
    await service.close();
    await dbOptions.cleanup();
  }
});
