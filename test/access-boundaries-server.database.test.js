import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server.js";
import { testDatabase } from "./postgres.js";

test("sharing redacts invitees, scoped pairing stays file-bound, and revocation invalidates old capabilities", async () => {
  const db = await testDatabase(),
    codes = new Map();
  const service = createService({
    ...db,
    sendCode: async (message) => codes.set(message.to, message.code),
  });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  async function request(
    path,
    token,
    body,
    method = body ? "POST" : "GET",
    headers = {},
  ) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }
  async function login(email) {
    assert.equal(
      (await request("/api/auth/email/request", null, { email })).status,
      200,
    );
    const result = await request("/api/auth/email/verify", null, {
      email,
      code: codes.get(email),
    });
    assert.equal(result.status, 200);
    return result.body.token;
  }
  try {
    const owner = await login("owner@example.com"),
      reader = await login("reader@example.com");
    const publish = async (requestId) => {
      const result = await request("/api/publish", owner, {
        source: "<h1>Fixture</h1>",
        requestId,
        visibility: "unlisted",
        linkRole: "editor",
      });
      assert.equal(result.status, 201);
      return result.body;
    };
    const first = await publish("first"),
      second = await publish("second");
    const base = `/api/files/${first.id}`,
      other = `/api/files/${second.id}`;
    let policy = (await request(base + "/sharing", owner)).body.policy;
    async function patch(change) {
      const result = await request(base + "/sharing", owner, change, "PUT", {
        "If-Match": String(policy.version),
      });
      assert.equal(result.status, 200);
      policy = result.body.policy;
    }
    await patch({ email: "hidden-invitee@example.com", role: "viewer" });
    await patch({ linkRole: "viewer" });
    const visible = await request(base + "/sharing", reader);
    assert.equal(visible.status, 200);
    assert.deepEqual(visible.body.policy.shares, {});
    assert.equal(
      JSON.stringify(visible.body).includes("hidden-invitee@example.com"),
      false,
    );
    assert.equal(
      (
        await request(
          base + "/sharing",
          reader,
          { visibility: "public" },
          "PUT",
          { "If-Match": String(policy.version) },
        )
      ).status,
      403,
    );
    await patch({ linkRole: "editor" });
    // The hosted view's document grant is bound to this page.
    const host = await request(`/api/library/${first.id}/host`, reader);
    assert.equal(host.status, 200);
    const scoped = host.body.boot.token;
    assert.equal((await request(base + "/source", scoped)).status, 200);
    assert.equal((await request(other + "/source", scoped)).status, 403);
    assert.deepEqual((await request(base + "/permissions", scoped)).body, {
      role: "editor",
      read: true,
      comment: true,
      edit: false,
      manage: false,
    });
    for (const [route, body, method] of [
      ["sharing", { visibility: "public" }, "PUT"],
      ["source", { source: "changed" }, "PUT"],
      ["revoke", {}, "POST"],
    ])
      assert.equal(
        (await request(base + "/" + route, scoped, body, method)).status,
        route === "sharing" ? 401 : 403,
      );
    const revoked = await request(base + "/revoke", owner, {});
    assert.equal(revoked.status, 200);
    assert.equal((await request(base + "/source", scoped)).status, 403);
    assert.equal((await request(base + "/source", reader)).status, 200, "the account's link role still holds");
    assert.equal((await request(base + "/source", owner)).status, 200);
    await patch({ visibility: "private" });
    assert.equal((await request(base + "/source", reader)).status, 403);
    assert.equal((await request(base + "/source", owner)).status, 200);
  } finally {
    await new Promise((resolve) => service.server.close(resolve));
    await service.close();
    await db.cleanup();
  }
});
