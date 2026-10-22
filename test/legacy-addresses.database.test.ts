import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createLegacyRawRepository } from "../src/server/legacy-addresses-repository.ts";
import { hash } from "../src/server/text.ts";

test("raw repository selects the exact original and source under fresh account, document and group authority", async () => {
  const db = await testDatabase();
  try {
    await db.pool.query(
      await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
    );
    await db.pool.query(
      "INSERT INTO accounts(actor) VALUES('owner@example.test'),('reader@example.test')",
    );
    await db.pool.query(
      "INSERT INTO accounts(actor,principal_kind) VALUES('group:raw','group'); INSERT INTO groups(owner) VALUES('group:raw'); INSERT INTO group_memberships(owner,actor,role) VALUES('group:raw','reader@example.test','viewer')",
    );
    const database = createSqlDatabase({
      pool: db.pool,
      initialize: async () => {},
      statementTimeoutMs: 5000,
    });
    const repository = createLegacyRawRepository(database, () => 1000);
    for (const [id, owner, visibility] of [
      ["DOC001", "owner@example.test", "public"],
      ["AST001", "owner@example.test", "private"],
      ["GRP001", "group:raw", "private"],
    ]) {
      await db.pool.query(
        "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES($1,$2,'page',true,0)",
        [id, owner],
      );
      await db.pool.query(
        "INSERT INTO files(id,owner,share_hash,generation,head,access) VALUES($1,$2,'unused',1,'2',$3)",
        [
          id,
          owner,
          JSON.stringify({
            visibility,
            linkRole: "viewer",
            shares: {},
            version: 1,
          }),
        ],
      );
      await db.pool.query(
        "INSERT INTO sources(file_id,revision,content) VALUES($1,'1','<h1>original</h1>'),($1,'2','<h1>head</h1>'),($1,'3','<h1>missing original wrapper</h1>')",
        [id],
      );
    }
    for (const [token, actor, page, generation, expires] of [
      ["owner", "owner@example.test", null, null, 2000],
      ["reader", "reader@example.test", null, null, 2000],
      ["asset", "owner@example.test", "AST001", 1, 2000],
      ["parent", "owner@example.test", "DOC001", 1, 2000],
      ["expired", "owner@example.test", null, null, 500],
    ])
      await db.pool.query(
        "INSERT INTO sessions(token_hash,actor,file_id,generation,purpose,expires) VALUES($1,$2,$3,$4,$5,$6)",
        [
          hash(String(token)),
          actor,
          page,
          generation,
          page ? "document" : null,
          expires,
        ],
      );
    const original1 = "a".repeat(64),
      original2 = "b".repeat(64),
      small = "c".repeat(64);
    for (const [revision, variant, digest] of [
      ["1", "original", original1],
      ["2", "original", original2],
      ["1", "small", small],
    ])
      await db.pool.query(
        "INSERT INTO page_assets(page_id,revision,variant,sha256,content_type,byte_length,storage_key) VALUES('AST001',$1,$2,$3,'image/webp',8,$3)",
        [revision, variant, digest],
      );
    assert.deepEqual(await repository.read("DOC001", "", 1), {
      kind: "document",
      source: "<h1>original</h1>",
    });
    assert.deepEqual(await repository.read("DOC001", ""), {
      kind: "document",
      source: "<h1>head</h1>",
    });
    assert.equal(await repository.read("DOC001", "", 99), null);
    assert.equal(await repository.read("DOC001", "not-a-session", 1), null);
    for (const token of ["", "reader", "parent", "expired", "not-a-session"])
      assert.equal(await repository.read("AST001", token, 1), null, token);
    const first = {
      kind: "media",
      address: {
        pageId: "AST001",
        revision: "1",
        variant: "original",
        sha256: original1,
      },
    };
    assert.deepEqual(await repository.read("AST001", "owner", 1), first);
    assert.deepEqual(await repository.read("AST001", "asset", 1), first);
    assert.deepEqual(await repository.read("AST001", "owner"), {
      kind: "media",
      address: { ...first.address, revision: "2", sha256: original2 },
    });
    assert.equal(
      await repository.read("AST001", "owner", 3),
      null,
      "missing original never returns wrapper or another revision",
    );
    assert.ok(await repository.read("GRP001", "reader", 1));
    await db.pool.query(
      "DELETE FROM group_memberships WHERE owner='group:raw'",
    );
    assert.equal(await repository.read("GRP001", "reader", 1), null);
    await db.pool.query("UPDATE files SET generation=2 WHERE id='AST001'");
    assert.equal(await repository.read("AST001", "asset", 1), null);
    await db.pool.query("UPDATE files SET deleted_at=1000 WHERE id='AST001'");
    assert.equal(await repository.read("AST001", "owner", 1), null);
  } finally {
    await db.cleanup();
  }
});
