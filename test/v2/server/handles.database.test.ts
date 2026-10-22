/**
 * GET/PUT/DELETE /api/account/handle and GET /api/auth/session's handle: every
 * status in src/server/handles-contracts.ts, uniqueness across accounts, and a
 * changed or cleared handle freed at once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HandleResponse } from "../../../src/server/handles-contracts.ts";
import { startServer, type TestServer } from "../support/server.ts";

const ROUTE = "/api/account/handle";
const put = (server: TestServer, token: string, handle: unknown) =>
  server.request(ROUTE, { method: "PUT", token, body: { handle } });
const read = async (server: TestServer, token: string) => {
  const response = await server.request(ROUTE, { token });
  assert.equal(response.status, 200);
  return ((await response.json()) as HandleResponse).handle;
};

test("an account has no handle until it chooses one, can change it and clear it, and the session names it", async () => {
  const server = await startServer();
  try {
    const token = await server.token("alice@example.test");
    assert.equal(await read(server, token), null);
    assert.deepEqual(await (await server.request("/api/auth/session", { token })).json(), {
      username: "alice@example.test",
      handle: null,
    });

    const saved = await put(server, token, "  Alice-Smith ");
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { handle: "alice-smith" }, "trimmed and lowercased");
    assert.equal(await read(server, token), "alice-smith");
    assert.deepEqual(await (await server.request("/api/auth/session", { token })).json(), {
      username: "alice@example.test",
      handle: "alice-smith",
    });
    assert.equal((await put(server, token, "alice-smith")).status, 200, "saving the same handle again is fine");

    assert.deepEqual(await (await put(server, token, "alice")).json(), { handle: "alice" });
    const bob = await server.token("bob@example.test");
    assert.deepEqual(await (await put(server, bob, "alice-smith")).json(), { handle: "alice-smith" }, "the old handle is free");

    const cleared = await server.request(ROUTE, { method: "DELETE", token });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await cleared.json(), { handle: null });
    assert.equal(await read(server, token), null);
    assert.equal((await server.request(ROUTE, { method: "DELETE", token })).status, 200, "clearing twice is fine");
    assert.deepEqual(await (await put(server, bob, "alice")).json(), { handle: "alice" }, "a cleared handle is free");
  } finally {
    await server.close();
  }
});

test("a handle another account holds is 409 in any case; a refused one is 422; no account is 401", async () => {
  const server = await startServer();
  try {
    const alice = await server.token("alice@example.test");
    const bob = await server.token("bob@example.test");
    assert.equal((await put(server, alice, "alice")).status, 200);
    for (const taken of ["alice", "ALICE", " Alice "]) {
      const response = await put(server, bob, taken);
      assert.equal(response.status, 409, taken);
      assert.match(((await response.json()) as { error: string }).error, /taken/i);
    }
    assert.equal(await read(server, bob), null, "a refused write changes nothing");
    for (const refused of ["ab", "x".repeat(33), "-bob", "bob-", "b--ob", "bob@example.test", "api", "admin", "connect", "pagegi", 12, null]) {
      const response = await put(server, bob, refused);
      assert.equal(response.status, 422, String(refused));
      assert.ok(((await response.json()) as { error: string }).error, String(refused));
    }
    assert.equal(await read(server, bob), null);
    for (const method of ["GET", "PUT", "DELETE"]) {
      const anonymous = await server.request(ROUTE, { method, ...(method === "PUT" ? { body: { handle: "carol" } } : {}) });
      assert.equal(anonymous.status, 401, method);
      assert.equal((await server.request(ROUTE, { method, token: "nope" })).status, 401, method);
    }
    assert.equal((await server.request(ROUTE, { method: "POST", token: bob, body: { handle: "bob" } })).status, 405);
  } finally {
    await server.close();
  }
});

test("the home page's cookie session reads and writes the handle from the same origin only", async () => {
  const server = await startServer();
  try {
    const signedIn = await server.request("/api/auth/test-token", {
      body: { email: "home@example.test", browserSession: true },
      headers: { Origin: server.origin },
    });
    const cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0]!;
    const home = { Cookie: cookie, "X-Pagegi-Home": "1" };
    assert.deepEqual(await (await server.request(ROUTE, { headers: home })).json(), { handle: null });
    const crossSite = await server.request(ROUTE, { method: "PUT", body: { handle: "home-page" }, headers: { ...home, Origin: "https://elsewhere.example" } });
    assert.equal(crossSite.status, 403);
    const saved = await server.request(ROUTE, { method: "PUT", body: { handle: "home-page" }, headers: { ...home, Origin: server.origin } });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { handle: "home-page" });
    assert.equal((await server.request(ROUTE, { headers: { Cookie: cookie } })).status, 401, "the cookie counts only from the home page");
  } finally {
    await server.close();
  }
});

test("underscore handles upgrade the old SQL constraint and preserve exact route identity and remain case-insensitively unique", async () => {
  const server = await startServer({}, async (query) => {
    await query(
      "CREATE TABLE accounts(actor text PRIMARY KEY,salt text,password text,name text,image text,space text NOT NULL DEFAULT gen_random_uuid()::text,handle text CHECK(handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(handle) BETWEEN 3 AND 32))",
    );
  });
  try {
    const alice = await server.token("underscore@example.test"),
      bob = await server.token("second@example.test");
    for (const handle of ["_name", "name_", "na__me", "___"]) {
      const saved = await put(server, alice, handle.toUpperCase());
      assert.equal(saved.status, 200);
      assert.equal(await read(server, alice), handle);
      assert.equal((await put(server, bob, handle)).status, 409);
    }
  } finally {
    await server.close();
  }
});
