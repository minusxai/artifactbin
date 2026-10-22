import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createService } from "../src/server.js";
import { mediaAddress } from "../src/media/address.ts";
import { hash } from "../src/server/text.ts";
import { testDatabase } from "./postgres.js";

test("media GET/HEAD/ranges enforce the asset own current account/group ACL and reject parent/backend grants", async () => {
  const db = await testDatabase();
  const root = await mkdtemp(join(tmpdir(), "media-server-"));
  const now = () => 10000;
  const bytes = Buffer.from([0, 255, 17, 128, 1, 2]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const service = createService({ ...db, mediaDirectory: root, now });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin = "http://127.0.0.1:" + service.server.address().port;
  try {
    await fetch(origin + "/health");
    for (const actor of [
      "owner@example.test",
      "reader@example.test",
      "member@example.test",
      "outsider@example.test",
    ])
      await db.pool.query("INSERT INTO accounts(actor) VALUES($1)", [actor]);
    await db.pool.query(
      "INSERT INTO accounts(actor,principal_kind) VALUES('group:media','group');INSERT INTO groups(owner) VALUES('group:media');INSERT INTO group_memberships(owner,actor,role) VALUES('group:media','member@example.test','viewer')",
    );
    const definitions = [
      [
        "AST001",
        "owner@example.test",
        "private",
        { "reader@example.test": "viewer" },
      ],
      ["PUB001", "owner@example.test", "public", {}],
      ["LNK001", "owner@example.test", "unlisted", {}],
      ["GRP001", "group:media", "private", {}],
      ["PAR001", "owner@example.test", "public", {}],
    ];
    for (const [id, owner, visibility, shares] of definitions) {
      await db.pool.query(
        "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES($1,$2,'page',true,0)",
        [id, owner],
      );
      await db.pool.query(
        "INSERT INTO files(id,owner,share_hash,generation,head,access) VALUES($1,$2,$3,1,'1',$4::jsonb)",
        [
          id,
          owner,
          hash("unused-share"),
          JSON.stringify({
            visibility,
            linkRole: "viewer",
            shares,
            version: 1,
          }),
        ],
      );
      await db.pool.query(
        "INSERT INTO sources(file_id,revision,content) VALUES($1,'1','<!doctype html><title>Asset</title>')",
        [id],
      );
      if (id !== "PAR001")
        await db.pool.query(
          "INSERT INTO page_assets(page_id,revision,variant,sha256,content_type,filename,byte_length,storage_key) VALUES($1,'1','original',$2,'image/png','sample.png',$3,$2)",
          [id, sha256, bytes.length],
        );
    }
    const sessions = [
      ["owner", "owner@example.test", null, null, null, 99999],
      ["reader", "reader@example.test", null, null, null, 99999],
      ["member", "member@example.test", null, null, null, 99999],
      ["outsider", "outsider@example.test", null, null, null, 99999],
      ["parent", "owner@example.test", "PAR001", 1, "document", 99999],
      ["asset", "owner@example.test", "AST001", 1, "document", 99999],
      ["expired", "owner@example.test", "AST001", 1, "document", 9999],
      ["oldgeneration", "owner@example.test", "AST001", 0, "document", 99999],
      ["backend", "owner@example.test", "AST001", 1, "backend", 99999],
    ];
    for (const [token, actor, fileId, generation, purpose, expires] of sessions)
      await db.pool.query(
        "INSERT INTO sessions(token_hash,actor,file_id,generation,purpose,expires) VALUES($1,$2,$3,$4,$5,$6)",
        [hash(token), actor, fileId, generation, purpose, expires],
      );
    await writeFile(join(root, sha256), bytes, { mode: 0o600 });
    const path = (id) =>
      mediaAddress({ pageId: id, revision: "1", variant: "original", sha256 });
    const get = (id, token, extra = {}) =>
      fetch(origin + path(id), {
        ...extra,
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...extra.headers,
        },
      });
    for (const token of [
      "",
      "outsider",
      "parent",
      "backend",
      "expired",
      "oldgeneration",
      "invalid",
    ]) {
      const response = await get("AST001", token, {
        headers: { Range: "bytes=999-" },
      });
      assert.equal(response.status, 404, token);
      assert.equal(response.headers.get("content-range"), null);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
    for (const token of ["owner", "reader", "asset"])
      assert.equal((await get("AST001", token)).status, 200, token);
    assert.equal((await get("PUB001", "")).status, 200);
    assert.equal((await get("LNK001", "")).status, 200);
    assert.equal((await get("GRP001", "member")).status, 200);
    assert.equal((await get("GRP001", "outsider")).status, 404);
    await db.pool.query(
      "DELETE FROM group_memberships WHERE owner='group:media' AND actor='member@example.test'",
    );
    assert.equal((await get("GRP001", "member")).status, 404);
    const cookie = await get("AST001", "", {
      headers: { Cookie: "pagegi_account=owner" },
    });
    assert.equal(cookie.status, 200);
    assert.equal(
      cookie.headers.get("cross-origin-resource-policy"),
      "same-site",
    );
    assert.equal(cookie.headers.get("access-control-allow-origin"), null);
    const range = await get("AST001", "owner", {
      headers: { Range: "bytes=1-3" },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 1-3/6");
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      bytes.subarray(1, 4),
    );
    const ignoredValidator = await get("AST001", "owner", {
      headers: { Range: "bytes=1-3", "If-Range": '"unknown"' },
    });
    assert.equal(ignoredValidator.status, 200);
    const head = await get("AST001", "reader", {
      method: "HEAD",
      headers: { Range: "bytes=1-3" },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "6");
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(
      (await get("AST001", "owner", { headers: { Range: "bytes=999-" } }))
        .status,
      416,
    );
    assert.equal(
      (await fetch(origin + path("AST001"), { method: "OPTIONS" })).headers.get(
        "access-control-allow-origin",
      ),
      null,
    );
    assert.equal(
      (await fetch(origin + path("AST001") + "?token=owner")).status,
      404,
    );
    assert.equal(
      (
        await fetch(origin + path("AST001").replace(sha256, "b".repeat(64)), {
          headers: { Authorization: "Bearer owner" },
        })
      ).status,
      404,
    );
    await db.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{shares}','{}') WHERE id='AST001'",
    );
    assert.equal((await get("AST001", "reader")).status, 404);
    await db.pool.query("UPDATE files SET generation=2 WHERE id='AST001'");
    assert.equal((await get("AST001", "asset")).status, 404);
    await rm(join(root, sha256));
    assert.equal((await get("AST001", "owner")).status, 503);
    await db.pool.query("DELETE FROM sources WHERE file_id='AST001'");
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM page_assets WHERE page_id='AST001'",
        )
      ).rows[0].count,
      0,
    );
  } finally {
    service.server.closeAllConnections();
    await new Promise((resolve) => service.server.close(resolve));
    await service.close();
    await db.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
