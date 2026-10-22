import { supplementalRepository } from "../src/persistence/supplemental-media.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createService } from "../src/server.js";
import { supplementalAddress } from "../src/media/supplemental-address.ts";
import { hash } from "../src/server/text.ts";
import { testDatabase } from "./postgres.js";

test("comment attachment GET/HEAD/ranges enforce current page ACL, group revocation and unchanged comment metadata", async () => {
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
      if (id !== "PAR001") {
        await db.pool.query(
          "INSERT INTO comments(file_id,id,node_id,quote,body,source_revision,published_by,created_at,revision,resolved,fingerprint,sequence) VALUES($1,'comment','stable-node','Original quote','Original body','1','owner@example.test','now',0,false,'fingerprint',1)",
          [id],
        );
        await db.pool.query(
          "INSERT INTO comment_attachment_assets(page_id,comment_id,attachment_id,variant,name,sha256,content_type,byte_length,storage_key,width,height) VALUES($1,'comment','attachment','original','sample.webp',$2,'image/webp',$3,$2,1,1)",
          [id, sha256, bytes.length],
        );
      }
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
      supplementalAddress({
        kind: "comment",
        pageId: id,
        commentId: "comment",
        attachmentId: "attachment",
        variant: "original",
      });
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
    await db.pool.query("UPDATE files SET share_hash=$1 WHERE id='LNK001'", [
      hash("guest-link"),
    ]);
    assert.equal(
      (await get("LNK001", "guest-link")).status,
      200,
      "hosted guest link credential",
    );
    assert.equal(
      (await get("PUB001", "guest-link")).status,
      404,
      "link is page scoped",
    );
    assert.equal((await get("LNK001", "invalid")).status, 404);
    assert.equal(
      (await get("LNK001", "guest-link", { method: "HEAD" })).status,
      200,
    );
    assert.equal(
      (await get("LNK001", "guest-link", { headers: { Range: "bytes=0-1" } }))
        .status,
      206,
    );
    await db.pool.query("UPDATE files SET share_hash=$1 WHERE id='AST001'", [
      hash("private-link"),
    ]);
    assert.equal(
      (await get("AST001", "private-link")).status,
      404,
      "private policy still requires an invited identity",
    );
    await db.pool.query("UPDATE files SET share_hash=$1 WHERE id='LNK001'", [
      hash("rotated-link"),
    ]);
    assert.equal(
      (await get("LNK001", "guest-link")).status,
      404,
      "rotated link denied",
    );
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
        await fetch(
          origin + path("AST001").replace("/attachment/", "/different/"),
          {
            headers: { Authorization: "Bearer owner" },
          },
        )
      ).status,
      404,
    );
    // The avatar proof is opaque; a current registered person occurrence must authorize it again.
    const avatarId = "a".repeat(64),
      avatar = {
        kind: "person",
        pageId: "AST001",
        valueName: "assignee",
        assetId: avatarId,
      };
    await db.pool.query(
      "INSERT INTO profile_assets(source_namespace,legacy_user_id,asset_id,sha256,byte_length,width,height,content_type,storage_key) VALUES('synthetic','private-user',$1,$2,6,1,1,'image/webp',$2)",
      [avatarId, sha256],
    );
    await db.pool.query(
      "INSERT INTO dataset_public_profiles(source_namespace,legacy_user_id,name,image) VALUES('synthetic','private-user','A Person',$1)",
      [avatarId],
    );
    await db.pool.query(
      "INSERT INTO dataset_person_bindings(backend_id,backend_version,page_id,page_version,value_name,source_namespace,descriptor) VALUES('BE0001','compiled','AST001',1,'assignee','synthetic','{}')",
    );
    await db.pool.query(
      "INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('BE0001','owner@example.test','compiled')",
    );
    await db.pool.query(
      "INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES('BE0001','compiled','AST001',1,'type Query { x: Int }','{}')",
    );
    await db.pool.query(
      "INSERT INTO af_page_backends(page_id,page_version,position,name,file_id,version) VALUES('AST001',1,0,'tasks','BE0001','compiled')",
    );
    const sql = createSqlDatabase({
      pool: db.pool,
      initialize: async () => {},
      statementTimeoutMs: 5000,
    });
    let selected = true,
      calls = 0,
      revokeDuringRead = false;
    const avatars = supplementalRepository(sql, now, {
      async person(context, input) {
        calls++;
        assert.equal(context.subject, "owner@example.test");
        assert.equal(input.userId, "private-user");
        if (revokeDuringRead)
          await db.pool.query(
            "UPDATE files SET generation=2 WHERE id='AST001'",
          );
        return selected
          ? {
              name: "A Person",
              handle: null,
              image: supplementalAddress(avatar),
            }
          : null;
      },
    });
    assert.ok(await avatars.read(avatar, "owner"));
    assert.equal(calls, 1);
    selected = false;
    assert.equal(await avatars.read(avatar, "owner"), null);
    selected = true;
    assert.equal(
      await avatars.read({ ...avatar, valueName: "other" }, "owner"),
      null,
    );
    assert.equal(await avatars.read(avatar, "parent"), null);
    revokeDuringRead = true;
    assert.equal(await avatars.read(avatar, "asset"), null);
    await db.pool.query("UPDATE files SET generation=1 WHERE id='AST001'");
    await db.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{shares}','{}') WHERE id='AST001'",
    );
    assert.equal((await get("AST001", "reader")).status, 404);
    await db.pool.query("UPDATE files SET generation=2 WHERE id='AST001'");
    assert.equal((await get("AST001", "asset")).status, 404);
    await rm(join(root, sha256));
    assert.equal((await get("AST001", "owner")).status, 503);
    const listed = await fetch(origin + "/api/files/PUB001/comments").then(
      (r) => r.json(),
    );
    assert.equal(listed.comments[0].body, "Original body");
    assert.equal(listed.comments[0].nodeId, "stable-node");
    assert.equal(listed.comments[0].quote, "Original quote");
    assert.equal(listed.comments[0].attachments[0].variants[0].sha256, sha256);
    await db.pool.query(
      "DELETE FROM comment_attachment_assets WHERE page_id='AST001'",
    );
    await db.pool.query("DELETE FROM comments WHERE file_id='AST001'");
    assert.equal((await get("AST001", "owner")).status, 404);
  } finally {
    service.server.closeAllConnections();
    await new Promise((resolve) => service.server.close(resolve));
    await service.close();
    await db.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
