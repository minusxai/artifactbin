import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createDocumentCatalog } from "../src/persistence/document-catalog.js";
import { createPathCatalog } from "../src/persistence/path-catalog.js";
import { createGroupMembershipRepository } from "../src/persistence/group-memberships.ts";
test("namespace locators expose only current active memberships and never another user's namespace", async () => {
  const db = await testDatabase();
  try {
    await db.pool.query(
      await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
    );
    await db.pool.query(
      "INSERT INTO accounts(actor,principal_kind,name,handle) VALUES('member','user','Personal fixture',null),('other','user','Other',null),('group:one','group','Team fixture','team_fixture'),('group:two','group','Unrelated',null)",
    );
    await db.pool.query(
      "INSERT INTO groups(owner) VALUES('group:one'),('group:two')",
    );
    const sql = createSqlDatabase({
      pool: db.pool,
      initialize: async () => {},
      statementTimeoutMs: 5000,
    });
    const catalog = createDocumentCatalog(sql),
      paths = createPathCatalog(sql),
      members = createGroupMembershipRepository(sql);
    await members.set("group:one", "member", "viewer");
    await db.pool.query(
      "INSERT INTO folders(owner,path) VALUES('group:one','/Team'),('member','/Personal'),('other','/Hidden')",
    );
    const options = await catalog.namespaces("member");
    assert.deepEqual(
      options.map((o) => [o.owner, o.name, o.handle, o.role]),
      [
        ["group:one", "Team fixture", "team_fixture", "viewer"],
        ["member", "Personal fixture", null, null],
      ],
    );
    assert.deepEqual(
      (await paths.paths("member", "group:one")).map((p) => p.path),
      ["/Team"],
    );
    await assert.rejects(paths.paths("member", "other"), { status: 403 });
    await assert.rejects(catalog.library("member", "group:two"), {
      status: 403,
    });
    await members.set("group:one", "member", "editor");
    assert.equal((await catalog.namespaces("member"))[0]!.role, "editor");
    await members.set("group:one", "member", null);
    assert.deepEqual(
      (await catalog.namespaces("member")).map((o) => o.owner),
      ["member"],
    );
    await assert.rejects(paths.paths("member", "group:one"), { status: 403 });
    await assert.rejects(catalog.library("member", "group:one"), {
      status: 403,
    });
    await members.set("group:one", "member", "viewer");
    await db.pool.query(
      "UPDATE groups SET active=false WHERE owner='group:one'",
    );
    assert.deepEqual(
      (await catalog.namespaces("member")).map((o) => o.owner),
      ["member"],
    );
    await assert.rejects(paths.paths("member", "group:one"), { status: 403 });
  } finally {
    await db.cleanup();
  }
});
