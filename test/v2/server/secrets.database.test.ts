/**
 * GET/PUT/DELETE /api/secrets: every status in src/server/secrets-contracts.ts,
 * and a value never comes back over HTTP once stored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  SecretDeleteResponse,
  SecretsListResponse,
  SecretWriteResponse,
} from "../../../src/server/secrets-contracts.ts";
import { startServer } from "../support/server.ts";

const KEY = Uint8Array.from(Buffer.from("0123456789abcdef".repeat(4), "hex"));
const VALUE = "stored-value-that-must-never-come-back";

test("an account stores secrets by name, lists their names and times, replaces and removes them, and never reads a value back", async () => {
  let clock = Date.UTC(2026, 9, 21, 10, 0, 0);
  const server = await startServer({ secretsKey: KEY, now: () => clock });
  try {
    const token = await server.token("alice@example.test");
    const empty = await server.request("/api/secrets", { token });
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { secrets: [] });

    const put = await server.request("/api/secrets/STRIPE_KEY", { method: "PUT", token, body: { value: VALUE } });
    assert.equal(put.status, 200);
    const written = (await put.json()) as SecretWriteResponse;
    assert.deepEqual(written, { name: "STRIPE_KEY", updatedAt: "2026-10-21T10:00:00.000Z" });

    clock += 60_000;
    const second = await server.request("/api/secrets/DB_URL", { method: "PUT", token, body: { value: "postgres://x" } });
    assert.equal(second.status, 200);
    const listed = await server.request("/api/secrets", { token });
    assert.deepEqual((await listed.json()) as SecretsListResponse, {
      secrets: [
        { name: "DB_URL", updatedAt: "2026-10-21T10:01:00.000Z" },
        { name: "STRIPE_KEY", updatedAt: "2026-10-21T10:00:00.000Z" },
      ],
    });

    clock += 60_000;
    const replaced = await server.request("/api/secrets/STRIPE_KEY", { method: "PUT", token, body: { value: "sk_live_rotated" } });
    assert.equal(replaced.status, 200);
    assert.deepEqual(await replaced.json(), { name: "STRIPE_KEY", updatedAt: "2026-10-21T10:02:00.000Z" });
    const after = (await (await server.request("/api/secrets", { token })).json()) as SecretsListResponse;
    assert.equal(after.secrets.length, 2, "a replace does not add a row");
    for (const body of [JSON.stringify(written), JSON.stringify(after)]) {
      assert.ok(!body.includes(VALUE));
      assert.ok(!body.includes("sk_live_rotated"));
      assert.ok(!body.includes("postgres://x"));
    }
    const stored = await server.query("SELECT ciphertext FROM account_secrets WHERE name = 'STRIPE_KEY'");
    assert.equal(stored.rows.length, 1);
    assert.ok(!String(stored.rows[0]!.ciphertext).includes("sk_live_rotated"), "encrypted at rest");

    const removed = await server.request("/api/secrets/STRIPE_KEY", { method: "DELETE", token });
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()) as SecretDeleteResponse, { name: "STRIPE_KEY", deleted: true });
    const again = await server.request("/api/secrets/STRIPE_KEY", { method: "DELETE", token });
    assert.equal(again.status, 404);
    assert.deepEqual(
      ((await (await server.request("/api/secrets", { token })).json()) as SecretsListResponse).secrets.map((s) => s.name),
      ["DB_URL"],
    );

    // Secrets are per account.
    const other = await server.token("bob@example.test");
    assert.deepEqual(await (await server.request("/api/secrets", { token: other })).json(), { secrets: [] });
    assert.equal((await server.request("/api/secrets/DB_URL", { method: "DELETE", token: other })).status, 404);
  } finally {
    await server.close();
  }
});

test("a bad name, a bad value or a 65th secret is 422; a missing or dead token is 401", async () => {
  const server = await startServer({ secretsKey: KEY });
  try {
    const token = await server.token();
    for (const name of ["stripe_key", "1KEY", "KEY-1", "A".repeat(65), "KEY%20X", "ÄPI"]) {
      const response = await server.request(`/api/secrets/${name}`, { method: "PUT", token, body: { value: "x" } });
      assert.equal(response.status, 422, name);
      assert.match(((await response.json()) as { error: string }).error, /name/i);
    }
    for (const body of [{}, { value: "" }, { value: 42 }, { value: null }, { value: "x".repeat(4097) }, { value: "é".repeat(2049) }, { value: "a\0b" }]) {
      const response = await server.request("/api/secrets/OK_NAME", { method: "PUT", token, body });
      assert.equal(response.status, 422, JSON.stringify(body).slice(0, 40));
      assert.match(((await response.json()) as { error: string }).error, /value/i);
    }
    const edge = await server.request("/api/secrets/A", { method: "PUT", token, body: { value: "x".repeat(4096) } });
    assert.equal(edge.status, 200, "4096 bytes and a one-letter name are fine");
    assert.equal((await server.request(`/api/secrets/${"Z".repeat(64)}`, { method: "PUT", token, body: { value: "x" } })).status, 200);
    for (let index = 2; index < 64; index++)
      assert.equal((await server.request(`/api/secrets/S${index}`, { method: "PUT", token, body: { value: "x" } })).status, 200, `secret ${index + 1}`);
    const full = await server.request("/api/secrets/ONE_TOO_MANY", { method: "PUT", token, body: { value: "x" } });
    assert.equal(full.status, 422);
    assert.match(((await full.json()) as { error: string }).error, /64/);
    assert.equal((await server.request("/api/secrets/A", { method: "PUT", token, body: { value: "replace" } })).status, 200, "replacing keeps the count");

    assert.equal((await server.request("/api/secrets")).status, 401);
    assert.equal((await server.request("/api/secrets/A", { method: "PUT", body: { value: "x" } })).status, 401);
    assert.equal((await server.request("/api/secrets/A", { method: "DELETE" })).status, 401);
    assert.equal((await server.request("/api/secrets", { token: "not-a-token" })).status, 401);
    assert.equal((await server.request("/api/secrets/A", { method: "GET", token })).status, 405);
    assert.equal((await server.request("/api/secrets", { method: "DELETE", token })).status, 405);
  } finally {
    await server.close();
  }
});

test("the home page's cookie session manages secrets from the same origin only", async () => {
  const server = await startServer({ secretsKey: KEY });
  try {
    const signIn = await server.request("/api/auth/test-token", {
      body: { email: "home@example.test", browserSession: true },
      headers: { Origin: server.origin },
    });
    assert.equal(signIn.status, 200);
    const cookie = /pagegi_account=([^;]+)/.exec(signIn.headers.get("set-cookie") ?? "")?.[0];
    assert.ok(cookie);
    const home = { Cookie: cookie, "X-Pagegi-Home": "1" };
    const put = await server.request("/api/secrets/HOME_KEY", { method: "PUT", body: { value: "v" }, headers: { ...home, Origin: server.origin } });
    assert.equal(put.status, 200);
    const list = await server.request("/api/secrets", { headers: home });
    assert.equal(list.status, 200);
    assert.deepEqual(((await list.json()) as SecretsListResponse).secrets.map((s) => s.name), ["HOME_KEY"]);
    const forged = await server.request("/api/secrets/HOME_KEY", { method: "DELETE", headers: { ...home, Origin: "https://evil.example" } });
    assert.equal(forged.status, 403, "a cross-site write with the cookie is refused");
    assert.equal((await server.request("/api/secrets", { headers: { Cookie: cookie } })).status, 401, "the cookie alone, without the home page header, is not a credential");
    assert.equal((await server.request("/api/secrets/HOME_KEY", { method: "DELETE", headers: { ...home, Origin: server.origin } })).status, 200);
  } finally {
    await server.close();
  }
});

test("without PAGEGI_SECRETS_KEY every secrets route answers 503 and nothing is stored", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    for (const [path, method, body] of [
      ["/api/secrets", "GET", undefined],
      ["/api/secrets/A", "PUT", { value: "x" }],
      ["/api/secrets/A", "DELETE", undefined],
    ] as const) {
      const response = await server.request(path, { method, token, ...(body ? { body } : {}) });
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: "Secrets are not configured" });
    }
    assert.equal((await server.request("/api/secrets")).status, 503, "configuration comes before credentials");
    assert.deepEqual((await server.query("SELECT count(*)::int AS n FROM account_secrets")).rows, [{ n: 0 }]);
  } finally {
    await server.close();
  }
});
