/**
 * The connect routes against the real server: a downloaded file's frame begins
 * a connection, the viewer approves it with their website session, and the
 * grant the frame polls is a page grant for comments and presence only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommentRecord, CommentsResponse, PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { page, startServer, type TestServer } from "../support/server.ts";

async function browserSession(server: TestServer, email: string): Promise<Record<string, string>> {
  const response = await server.request("/api/auth/test-token", {
    body: { email, browserSession: true },
    headers: { Origin: server.origin },
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { Cookie: cookie, Origin: server.origin, "X-Pagegi-Home": "1" };
}

test("a downloaded file connects to its page through an approval in the viewer's website session", async () => {
  const server = await startServer();
  try {
    const owner = await server.token("owner@example.test");
    const published = (await (
      await server.request("/api/publish", {
        token: owner,
        body: { source: page("<h1>Plan</h1>"), requestId: "connect", visibility: "private" },
      })
    ).json()) as PublishResponse;
    const nodeId = /<h1 data-af-id="([^"]+)">/.exec(published.source)?.[1];
    assert.ok(nodeId);
    const sharing = (await (await server.request(`/api/files/${published.id}/sharing`, { token: owner })).json()) as {
      policy: { version: number };
    };
    const shared = await server.request(`/api/files/${published.id}/sharing`, {
      method: "PUT",
      token: owner,
      body: { email: "reader@example.test", role: "commenter" },
      headers: { "If-Match": String(sharing.policy.version) },
    });
    assert.equal(shared.status, 200, await shared.text());

    assert.equal((await server.request("/api/pair", { body: { fileId: "Zz9Zz9" } })).status, 404);
    const begun = await server.request("/api/pair", { body: { fileId: published.id } });
    assert.equal(begun.status, 201);
    const { code, deviceCode } = (await begun.json()) as { code: string; deviceCode: string };
    // A code tells a stranger nothing about a private page; a reader sees its path.
    const info = await server.request(`/api/pair/info?code=${encodeURIComponent(code)}`);
    assert.equal(info.status, 200);
    assert.deepEqual(await info.json(), { fileId: published.id, path: null });
    assert.equal((await server.request("/api/pair/poll", { body: { deviceCode } })).status, 202);

    // The approval page is served on the platform origin with its own script.
    const approval = await server.request(`/connect?code=${encodeURIComponent(code)}`);
    assert.equal(approval.status, 200);
    assert.match(approval.headers.get("content-type") ?? "", /text\/html/);
    assert.match(approval.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.match(await approval.text(), /<script src="\/connect\.js"/);
    assert.equal((await server.request("/connect.js")).status, 200);

    // Approval is a same-origin website action, and the account must be able to read the page.
    assert.equal((await server.request("/api/pair/approve", { body: { code } })).status, 403);
    const stranger = await browserSession(server, "stranger@example.test");
    assert.equal((await server.request("/api/pair/approve", { body: { code }, headers: stranger })).status, 403);
    assert.equal((await server.request("/api/pair/poll", { body: { deviceCode } })).status, 202);
    const reader = await browserSession(server, "reader@example.test");
    assert.deepEqual(
      await (await server.request(`/api/pair/info?code=${encodeURIComponent(code)}`, { headers: reader })).json(),
      { fileId: published.id, path: published.path },
    );
    const approved = await server.request("/api/pair/approve", { body: { code }, headers: reader });
    assert.equal(approved.status, 200, await approved.text());
    assert.equal((await server.request("/api/pair/approve", { body: { code }, headers: reader })).status, 409);

    const polled = await server.request("/api/pair/poll", { body: { deviceCode } });
    assert.equal(polled.status, 200);
    const grant = (await polled.json()) as { token: string; username: string; purpose: string };
    assert.equal(grant.username, "reader@example.test");
    assert.equal(grant.purpose, "document");
    assert.notEqual(grant.token, reader.Cookie!.split("=")[1]);
    assert.equal((await server.request("/api/pair/poll", { body: { deviceCode } })).status, 410);

    // The grant comments and reads as the reader, and nothing more.
    const comment = await server.request(`/api/files/${published.id}/comments`, {
      token: grant.token,
      body: { comment: { nodeId, quote: "Plan", body: "From my downloaded copy" } },
    });
    assert.equal(comment.status, 201);
    assert.equal(((await comment.json()) as CommentRecord).author, "reader@example.test");
    const listed = (await (await server.request(`/api/files/${published.id}/comments`, { token: grant.token })).json()) as CommentsResponse;
    assert.equal(listed.comments.length, 1);
    assert.equal((await server.request(`/api/library/${published.id}/host`, { token: grant.token })).status, 200);
    assert.equal((await server.request("/api/auth/session", { token: grant.token })).status, 401);
    assert.equal((await server.request("/api/library", { token: grant.token, headers: { "X-Pagegi-Home": "1" } })).status, 401);
    const save = await server.request(`/api/files/${published.id}/source`, {
      method: "PUT",
      token: grant.token,
      body: { source: published.source },
      headers: { "If-Match": "1" },
    });
    assert.notEqual(save.status, 200, "a page grant never saves source");
    assert.notEqual((await server.request(`/api/files/${published.id}/sharing`, { token: grant.token })).status, 200);
  } finally {
    await server.close();
  }
});

test("a grant issued after its connection expired is revoked, never left as a live session", async () => {
  const clock = { now: Date.now() };
  const server = await startServer({ now: () => clock.now });
  const lock = await server.connect();
  try {
    const owner = await server.token("owner@example.test");
    const published = (await (
      await server.request("/api/publish", {
        token: owner,
        body: { source: page("<h1>Plan</h1>"), requestId: "late-grant", visibility: "public" },
      })
    ).json()) as PublishResponse;
    const reader = await browserSession(server, "reader@example.test");
    const { code, deviceCode } = (await (await server.request("/api/pair", { body: { fileId: published.id } })).json()) as {
      code: string;
      deviceCode: string;
    };
    const documentSessions = async () =>
      (await server.query("SELECT count(*)::int AS n FROM sessions WHERE file_id=$1 AND purpose='document'", [published.id])).rows[0]!.n;
    assert.equal(await documentSessions(), 0);
    // Hold the grant's INSERT until the connection has expired.
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE sessions IN EXCLUSIVE MODE");
    const approval = server.request("/api/pair/approve", { body: { code }, headers: reader });
    for (let tries = 0; ; tries++) {
      const waiting = await lock.query("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND relation='sessions'::regclass");
      if (Number(waiting.rows[0]!.n) > 0) break;
      assert.ok(tries < 200, "the grant reached its INSERT");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    clock.now += 300_001;
    await lock.query("COMMIT");
    assert.equal((await approval).status, 410);
    assert.equal((await server.request("/api/pair/poll", { body: { deviceCode } })).status, 410);
    assert.equal(await documentSessions(), 0, "the late grant was revoked");
  } finally {
    await lock.query("ROLLBACK").catch(() => {});
    lock.release();
    await server.close();
  }
});
