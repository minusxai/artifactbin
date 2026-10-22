import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server.js";
import { createBackendHost } from "../src/backend/container-host.ts";
import { testDatabase } from "./postgres.js";

test("HTTP sandbox viewer capability uses original mapped identity and fresh page authority", async () => {
  const db = await testDatabase();
  const backendHost = createBackendHost({
    image: process.env.PAGEGI_BACKEND_IMAGE ?? "pagegi-backend:local",
    sandboxNetwork: "none",
  });
  const codes = new Map();
  const service = createService({
    ...db,
    backendHost,
    allowPasswordLogin: false,
    sendCode: async ({ to, code }) => codes.set(to, code),
  });
  try {
    await new Promise((resolve) =>
      service.server.listen(0, "127.0.0.1", resolve),
    );
    const origin = `http://127.0.0.1:${service.server.address().port}`;
    async function request(path, { token, body, method, headers } = {}) {
      const response = await fetch(origin + path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    async function identity(email) {
      assert.equal(
        (await request("/api/auth/email/request", { body: { email } })).status,
        200,
      );
      const result = await request("/api/auth/email/verify", {
        body: { email, code: codes.get(email) },
      });
      assert.equal(result.status, 200);
      return result.body.token;
    }
    const owner = await identity("viewer-owner@example.test");
    const unknown = await identity("viewer-unmapped@example.test");
    const reserved = await request("/api/ids", {
      token: owner,
      body: { count: 1 },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    assert.equal(reserved.status, 201);
    const backendId = reserved.body.ids[0];
    const backend = `export const typeDefs='type Viewer { generation:String! id:String } type Query { viewer:Viewer! forged:Viewer! }';export default {Query:{viewer:(_a,_p,caps)=>caps.dataset.viewer(),forged:(_a,_p,caps)=>caps.dataset.viewer({subject:'forged'})}};`;
    const publication = await request("/api/publish", {
      token: owner,
      body: {
        source: `<!doctype html><html><head><title>Reader projection boundary</title><script src="${origin}/af/v1/core.js"></script><link rel="af-backend" href="${origin}/af/v1/ids/${backendId}" data-af-name="legacyData"></head><body><h1>Reader projection boundary</h1></body></html>`,
        files: { [backendId]: backend },
        requestId: crypto.randomUUID(),
        visibility: "public",
        linkRole: "viewer",
      },
    });
    assert.equal(publication.status, 201);
    const id = publication.body.id;
    const {
      rows: [binding],
    } = await db.pool.query(
      "SELECT b.file_id,b.version,b.page_version,f.owner FROM af_page_backends b JOIN files f ON f.id=b.page_id WHERE b.page_id=$1 AND b.page_version=f.head::bigint",
      [id],
    );
    await db.pool.query(
      "INSERT INTO dataset_viewer_bindings VALUES($1,$2,$3,$4,$5)",
      [
        binding.file_id,
        binding.version,
        id,
        binding.page_version,
        "synthetic-viewer",
      ],
    );
    await db.pool.query(
      "INSERT INTO dataset_principals(source_namespace,actor,kind,legacy_id,identity,expires_at) VALUES($1,$2,'user','original-reader','user',NULL)",
      ["synthetic-viewer", binding.owner],
    );
    const query = (token) =>
      request(`/api/files/${id}/graphql`, {
        token,
        body: { query: "{legacyData{viewer{generation id}}}" },
      });
    const mapped = await query(owner);
    assert.equal(mapped.status, 200);
    assert.equal(mapped.body.data.legacyData.viewer.id, "original-reader");
    assert.match(
      mapped.body.data.legacyData.viewer.generation,
      /^[a-f0-9]{64}$/,
    );
    const guest = await query();
    assert.equal(guest.status, 200);
    assert.equal(guest.body.data.legacyData.viewer.id, null);
    const unmapped = await query(unknown);
    assert.equal(unmapped.body.data?.legacyData?.viewer ?? null, null);
    assert.ok(unmapped.body.errors?.length);
    const forged = await request(`/api/files/${id}/graphql`, {
      token: owner,
      body: { query: "{legacyData{forged{generation id}}}" },
    });
    assert.equal(forged.body.data?.legacyData?.forged ?? null, null);
    assert.ok(forged.body.errors?.length);
    await db.pool.query(
      "UPDATE dataset_principals SET expires_at=now()-interval '1 second' WHERE source_namespace='synthetic-viewer'",
    );
    const expired = await query(owner);
    assert.equal(expired.body.data?.legacyData?.viewer ?? null, null);
    assert.ok(expired.body.errors?.length);
    await db.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{visibility}','\"private\"') WHERE id=$1",
      [id],
    );
    const revoked = await query();
    assert.notEqual(revoked.status, 200);
  } finally {
    service.server.closeAllConnections();
    await new Promise((resolve) => service.server.close(resolve));
    await service.close();
    await backendHost.close?.();
    await db.cleanup();
  }
});
