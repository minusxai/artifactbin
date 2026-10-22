import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createGroupMembershipRepository, loadGroupAuthority } from "../src/persistence/group-memberships.ts";
import { permissions } from "../src/access.ts";

test("group revocation serializes with authorized work and group principals cannot authenticate", async () => {
  const db = await testDatabase();
  try {
    await db.pool.query(await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await db.pool.query("INSERT INTO accounts(actor,principal_kind) VALUES('group:one','group'),('member','user')");
    await db.pool.query("INSERT INTO groups(owner) VALUES('group:one')");
    const sql = createSqlDatabase({ pool: db.pool, initialize: async () => {}, statementTimeoutMs: 5000 });
    const repository = createGroupMembershipRepository(sql);
    await repository.set("group:one", "member", "editor");
    let release;
    const held = new Promise((r) => { release = r; });
    let ready;
    const started = new Promise((r) => { ready = r; });
    const operation = sql.transaction(async (client) => {
      const facts = await loadGroupAuthority(client, "member");
      assert.equal(permissions({ owner: "group:one", ownerKind: "group" }, "member", false, false, facts).manage, true);
      ready();
      await held;
    });
    await started;
    let revoked = false;
    const revocation = repository.set("group:one", "member", null).then(() => { revoked = true; });
    // A separate connection proves the exclusive group lock is waiting.
    let observedWaiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT owner FROM groups WHERE owner=%' AND datname=current_database()");
      if (waiting.rows.length) { observedWaiting = true; break; }
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(observedWaiting, true);
    assert.equal(revoked, false);
    release();
    await operation;
    await revocation;
    const facts = await sql.transaction((client) => loadGroupAuthority(client, "member"));
    assert.deepEqual(facts.memberships, []);
    await repository.set("group:one", "member", "viewer");
    await db.pool.query("UPDATE groups SET active=false WHERE owner='group:one'");
    assert.deepEqual((await sql.transaction((client) => loadGroupAuthority(client, "member"))).memberships, []);
    await assert.rejects(db.pool.query("INSERT INTO sessions(token_hash,actor,expires) VALUES('bad','group:one',9999999999999)"), /Only users can authenticate/);
    await assert.rejects(db.pool.query("UPDATE accounts SET password='bad' WHERE actor='group:one'"), /Groups cannot have login credentials/);
  } finally { await db.cleanup(); }
});

import { createService } from "../src/server.js";
test("imported group pages use fresh membership for source, sharing, discovery and deletion", async () => {
  const db = await testDatabase();
  const codes = new Map();
  const service = createService({ ...db, sendCode: async ({ to, code }) => codes.set(to, code) });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + service.server.address().port;
  async function request(path, token, body, method = body ? "POST" : "GET", headers = {}) {
    const response = await fetch(origin + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  }
  async function login(email) {
    await request("/api/auth/email/request", null, { email });
    return (await request("/api/auth/email/verify", null, { email, code: codes.get(email) })).body.token;
  }
  try {
    const editor = await login("editor@example.test"), viewer = await login("viewer@example.test"), outsider = await login("outsider@example.test");
    const publication = await request("/api/publish", editor, { source: "<title>Group</title><h1>Original</h1>", requestId: "group-test", visibility: "private" });
    assert.equal(publication.status, 201);
    const id = publication.body.id, base = "/api/files/" + id;
    await db.pool.query("INSERT INTO accounts(actor,principal_kind) VALUES('group:one','group')");
    await db.pool.query("INSERT INTO groups(owner) VALUES('group:one')");
    await db.pool.query("INSERT INTO group_memberships(owner,actor,role) VALUES('group:one','editor@example.test','editor'),('group:one','viewer@example.test','viewer')");
    await db.pool.query("UPDATE files SET owner='group:one' WHERE id=$1", [id]);
    await db.pool.query("UPDATE file_ids SET owner='group:one' WHERE id=$1", [id]);
    assert.equal((await request(base + "/source", editor)).status, 200);
    assert.equal((await request(base + "/source", viewer)).status, 200);
    assert.equal((await request(base + "/source", outsider)).status, 403);
    const sharing = await request(base + "/sharing", editor);
    assert.equal(sharing.body.permissions.manage, true);
    assert.equal((await request(base + "/comments", editor)).status, 200);
    assert.equal((await request(base + "/comments", viewer)).status, 200);
    assert.equal((await request(base + "/comments", outsider)).status, 403);
    assert.equal((await request(base + "/sharing", editor, { linkRole: "viewer" }, "PUT", { "If-Match": String(sharing.body.policy.version) })).status, 200);
    assert.equal((await request(base + "/sharing", viewer)).body.permissions.manage, false);
    const library = await request("/api/library", null, null, "GET", { "X-Pagegi-Home": "1", Cookie: "pagegi_account=" + viewer });
    assert.equal(library.body.sharedFiles[0].fileId, id);
    const saved = await request(base + "/source", editor, { source: "<title>Group</title><h1>Edited</h1>" }, "PUT", { "If-Match": "1" });
    assert.equal(saved.status, 200);
    assert.equal((await db.pool.query("SELECT owner FROM files WHERE id=$1", [id])).rows[0].owner, "group:one");
    assert.equal((await request(base, viewer, null, "DELETE")).status, 404);
    await db.pool.query("DELETE FROM group_memberships WHERE owner='group:one' AND actor='viewer@example.test'");
    assert.equal((await request(base + "/source", viewer)).status, 403);
    assert.equal((await request(base, editor, null, "DELETE")).status, 200);
  } finally {
    await new Promise((r) => service.server.close(r));
    await service.close();
    await db.cleanup();
  }
});
