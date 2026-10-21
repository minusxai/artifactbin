/**
 * Brief B additions: a page's data-af="state" block is where every viewer's
 * own local state starts (the server keeps it as the page's seed; viewers'
 * changes stay in their browsers), test login cannot run in production, and
 * its browser session is a normal cookie session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AfServerModule, PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { load } from "../support/load.ts";
import { page, startServer } from "../support/server.ts";

test("a data-af=state block seeds each viewer's local state, survives saves, and no shared state is served", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const head = `  <script type="application/json" data-af="state">{ "todos": [{ "id": "1", "text": "Seeded" }] }</script>\n`;
    const published = (await (
      await server.request("/api/publish", { token, body: { source: page("<h1>State</h1>", head), requestId: "state" } })
    ).json()) as PublishResponse;
    assert.doesNotMatch(published.source, /data-af="state"/, "the block becomes the page's seed, not source");
    const host = async () =>
      (await (await server.request(`/api/library/${published.id}/host`, { token })).json()) as { seed: unknown };
    assert.deepEqual((await host()).seed, { todos: [{ id: "1", text: "Seeded" }] });
    // Local state is per viewer: there is no server-side shared state to read or write.
    assert.equal((await server.request(`/api/files/${published.id}/sync`, { token })).status, 404);
    assert.equal(
      (await server.request(`/api/files/${published.id}/sync`, { token, body: { changes: [] } })).status,
      404,
    );

    const saved = await server.request(`/api/files/${published.id}/source`, {
      method: "PUT",
      token,
      body: { source: published.source.replace("State</h1>", "State, renamed</h1>") },
      headers: { "If-Match": "1" },
    });
    assert.equal(saved.status, 200);
    assert.deepEqual((await host()).seed, { todos: [{ id: "1", text: "Seeded" }] }, "a save keeps the seed");
    const download = await (await server.request(`/af/v1/ids/${published.id}?download=1`, { token })).text();
    assert.match(download, /<script type="application\/json" data-af="state">[\s\S]*Seeded/);

    // A save that carries a new block replaces the seed.
    const reseeded = await server.request(`/api/files/${published.id}/source`, {
      method: "PUT",
      token,
      body: { source: page("<h1>State</h1>", `  <script type="application/json" data-af="state">{ "filter": "done" }</script>\n`) },
      headers: { "If-Match": "2" },
    });
    assert.equal(reseeded.status, 200);
    assert.deepEqual((await host()).seed, { filter: "done" });
  } finally {
    await server.close();
  }
});

test("test login refuses to run in production and sets a browser session like email sign-in", async () => {
  const { createService } = await load<AfServerModule>("src/server.js");
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createService({ connectionString: "postgres://unused", testLogin: true }), /production/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  const server = await startServer();
  try {
    const crossSite = await server.request("/api/auth/test-token", {
      body: { email: "browser@example.test", browserSession: true },
      headers: { Origin: "https://elsewhere.example" },
    });
    assert.equal(crossSite.status, 403);
    const response = await server.request("/api/auth/test-token", {
      body: { email: "browser@example.test", browserSession: true },
      headers: { Origin: server.origin },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { username: "browser@example.test" });
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /pagegi_account=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict/);
    const session = await server.request("/api/library/session", {
      headers: { Cookie: cookie.split(";")[0]!, "X-Pagegi-Home": "1" },
    });
    assert.deepEqual(await session.json(), { username: "browser@example.test" });
  } finally {
    await server.close();
  }
});
