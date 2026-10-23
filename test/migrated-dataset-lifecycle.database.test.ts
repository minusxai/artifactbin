import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { testDatabase } from "./postgres.js";
import { insertPages } from "./fixtures/pages.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createTrashService } from "../src/trash/service.ts";
import { createPageService } from "../src/server/af-pages.ts";
import { datasetReadable } from "../src/datasets/policy/read.ts";
import {
  createDatasetReadRepository,
  loadDatasetAuthority,
} from "../src/persistence/datasets.ts";
import { syncMigratedDatasetLifecycle } from "../src/persistence/migrated-dataset-lifecycle.ts";
import { hash } from "../src/server/text.ts";
import type { DatasetBinding } from "../src/datasets/contracts.ts";
const access = {
  visibility: "private",
  linkRole: "viewer",
  shares: {},
  version: 0,
};
test("proven page and resource lifecycles restore/delete atomically while snapshots and independent resources remain intact", async () => {
  const env = await testDatabase();
  const sql = createSqlDatabase({
    pool: env.pool,
    initialize: async () => {},
    statementTimeoutMs: 15000,
  });
  try {
    for (const path of [
      "schema.sql",
      "backend/af-schema.sql",
      "datasets/schema.sql",
    ])
      await env.pool.query(
        await readFile(new URL("../src/" + path, import.meta.url), "utf8"),
      );
    await insertPages(env.pool, {
      accounts: { owner: {}, other: {} },
      tokens: {
        [hash("owner-token")]: { actor: "owner", expires: Date.now() + 60000 },
      },
      files: {
        Data01: {
          owner: "owner",
          head: "1",
          path: "/folder/data.html",
          access,
          sources: { "1": "old", "2": "head" },
        },
        Mark01: {
          owner: "owner",
          head: "1",
          path: "/folder/markup.html",
          access,
          sources: { "1": "markup" },
        },
        NoLink: {
          owner: "owner",
          head: "1",
          path: "/folder/unlinked.html",
          access,
          sources: { "1": "unlinked" },
        },
      },
    });
    const owner = { userId: "legacy-owner", tokenId: null };
    for (const id of ["legacy-data", "independent"])
      await env.pool.query(
        "INSERT INTO dataset_resources(source_namespace,legacy_id,current_version,policy_revision,owner,generation,access,deleted,snapshot) VALUES($1,$2,1,0,$3,1,$4,true,$5)",
        [
          "fixture",
          id,
          "owner",
          access,
          {
            id,
            owner,
            visibility: "private",
            policyRevision: 0,
            ownerIsTestUser: false,
            policy: null,
          },
        ],
      );
    for (const [id, legacy, format] of [
      ["Data01", "legacy-data", "dataset"],
      ["Mark01", "legacy-markup", "markup"],
      ["NoLink", "unlinked", "markup"],
    ])
      await env.pool.query("INSERT INTO dataset_pages VALUES($1,1,$2,$3)", [
        id,
        "fixture",
        {
          id: legacy,
          editId: "edit",
          owner,
          visibility: "private",
          format,
          deleted: true,
          ownerIsTestUser: false,
          acceptedJoinUserIds: [],
        },
      ]);
    await env.pool.query(
      `CREATE TABLE IF NOT EXISTS dataset_deleted_page_lifecycle_links(source_namespace text NOT NULL,legacy_id text NOT NULL,page_id text NOT NULL REFERENCES files(id),authority_sha256 text NOT NULL CHECK(authority_sha256 ~ '^[a-f0-9]{64}$'),PRIMARY KEY(source_namespace,legacy_id),UNIQUE(page_id)); CREATE TABLE IF NOT EXISTS dataset_deleted_lifecycle_links(source_namespace text NOT NULL,legacy_id text NOT NULL,page_id text NOT NULL REFERENCES dataset_deleted_page_lifecycle_links(page_id),authority_sha256 text NOT NULL,PRIMARY KEY(source_namespace,legacy_id),UNIQUE(page_id),FOREIGN KEY(source_namespace,legacy_id) REFERENCES dataset_resources(source_namespace,legacy_id))`,
    );
    for (const [id, legacy] of [
      ["Data01", "legacy-data"],
      ["Mark01", "legacy-markup"],
    ])
      await env.pool.query(
        "INSERT INTO dataset_deleted_page_lifecycle_links VALUES($1,$2,$3,$4)",
        ["fixture", legacy, id, "a".repeat(64)],
      );
    await env.pool.query(
      "INSERT INTO dataset_deleted_lifecycle_links VALUES($1,$2,$3,$4)",
      ["fixture", "legacy-data", "Data01", "a".repeat(64)],
    );
    await env.pool.query("UPDATE files SET deleted_at=1,trash_path=path");
    const trash = createTrashService(sql, (s) => {
      assert.equal(s?.actor, "owner");
      return s.actor;
    });
    const pages = createPageService({
      database: sql,
      authority: {
        account: (s) => {
          assert.equal(s?.actor, "owner");
          return s.actor;
        },
        issue: () => {
          throw Error("unused");
        },
      },
      pageModel: async () => {
        throw Error("unused");
      },
      backendFiles: async () => null,
      randomBytes,
      token: () => "",
      now: () => 100,
    });
    const restore = (id: string) =>
      trash.handle(
        "owner-token",
        new URL(`http://localhost/api/trash/${id}/restore`),
        "POST",
      );
    const status = async () =>
      (
        await env.pool.query(
          "SELECT legacy_id,deleted FROM dataset_resources ORDER BY legacy_id",
        )
      ).rows;
    const snapshots = (
      await env.pool.query("SELECT * FROM dataset_pages ORDER BY page_id")
    ).rows;
    await restore("Mark01");
    assert.deepEqual(await status(), [
      { legacy_id: "independent", deleted: true },
      { legacy_id: "legacy-data", deleted: true },
    ]);
    await restore("Data01");
    assert.equal((await status())[1]!.deleted, false);
    await pages.remove("owner-token", "Data01");
    assert.equal((await status())[1]!.deleted, true);
    // A live conflict refuses before either lifecycle can change.
    await insertPages(env.pool, {
      files: {
        Block1: {
          owner: "owner",
          head: "1",
          path: "/folder/data.html",
          sources: { "1": "block" },
        },
      },
    });
    await assert.rejects(restore("Data01"), (e: any) => e.status === 409);
    assert.equal((await status())[1]!.deleted, true);
    await env.pool.query("UPDATE files SET deleted_at=1 WHERE id='Block1'");
    await restore("Data01");
    // Exact proof mismatch aborts the entire file/resource change.
    await env.pool.query(
      "UPDATE dataset_resources SET owner='other' WHERE legacy_id='legacy-data'",
    );
    await assert.rejects(
      pages.remove("owner-token", "Data01"),
      /authority mismatch/,
    );
    assert.equal((await status())[1]!.deleted, false);
    assert.equal(
      (await env.pool.query("SELECT deleted_at FROM files WHERE id='Data01'"))
        .rows[0]!.deleted_at,
      null,
    );
    await env.pool.query(
      "UPDATE dataset_resources SET owner='owner' WHERE legacy_id='legacy-data'",
    );
    // Folder trash and restore touch only the explicit resource association.
    const batch = (await trash.handle(
      "owner-token",
      new URL("http://localhost/api/trash/folders"),
      "POST",
      { path: "/folder" },
    )) as { id: string };
    assert.equal((await status())[1]!.deleted, true);
    await restore(batch.id);
    assert.equal((await status())[1]!.deleted, false);
    assert.deepEqual(
      (await env.pool.query("SELECT * FROM dataset_pages ORDER BY page_id"))
        .rows,
      snapshots,
    );
    // A failure after synchronizing rolls back file and resource lifecycle together.
    await assert.rejects(
      sql.transaction(async (client) => {
        await client.query("UPDATE files SET deleted_at=5 WHERE id='Data01'");
        await syncMigratedDatasetLifecycle(client, "owner", ["Data01"]);
        throw Error("rollback");
      }),
      /rollback/,
    );
    assert.equal((await status())[1]!.deleted, false);
    // Current runtime authority projects only a proven page and still enforces ACL/resource state.
    const binding: DatasetBinding = {
      mode: "live",
      name: "data",
      backendId: "Back01",
      backendVersion: "v1",
      page: {
        id: "Mark01",
        version: 1,
        legacyId: "legacy-markup",
        editId: "edit",
      },
      dataset: { id: "legacy-data", version: 1, policyRevision: 0 },
      tables: [],
    };
    await env.pool.query(
      "INSERT INTO dataset_versions VALUES('fixture','legacy-data',1,'[]','{}','[]')",
    );
    await env.pool.query(
      "INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Back01','owner','v1');INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES('Back01','v1','Mark01',1,'type Query { x: String }','{}');INSERT INTO af_page_backends VALUES('Mark01',1,0,'data','Back01','v1')",
    );
    const { tables: _, ...descriptor } = binding;
    await env.pool.query(
      "INSERT INTO dataset_bindings VALUES('Back01','v1','Mark01',1,'data','fixture','legacy-data',1,$1)",
      [descriptor],
    );
    await env.pool.query(
      "INSERT INTO dataset_principals VALUES('fixture','owner','user','legacy-owner','user',NULL)",
    );
    const context = {
      backendId: "Back01",
      backendVersion: "v1",
      pageId: "Mark01",
      subject: "owner",
    };
    const authority = await sql.transaction((c) =>
      loadDatasetAuthority(c, context, binding, 100),
    );
    assert.equal(authority!.page.deleted, false);
    assert.equal(datasetReadable(authority!), true);
    assert.equal(
      (await sql.transaction((c) =>
        loadDatasetAuthority(c, context, binding, 100, true),
      ))!.page.deleted,
      false,
    );
    assert.equal(
      await sql.transaction((c) =>
        loadDatasetAuthority(c, { ...context, subject: "other" }, binding, 100),
      ),
      null,
    );
    const repository = createDatasetReadRepository(sql);
    const beforeGeneration = (await repository.binding(context, "data"))!
      .revision.generation;
    await pages.remove("owner-token", "Data01");
    assert.equal(
      await sql.transaction((c) =>
        loadDatasetAuthority(c, context, binding, 100),
      ),
      null,
    );
    assert.equal((await status())[0]!.deleted, true);
    // Concurrent retries serialize on file/path locks; one restores, one sees no trash entry.
    const results = await Promise.allSettled([
      restore("Data01"),
      restore("Data01"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await status())[1]!.deleted, false);
    const freshBinding = (await repository.binding(context, "data"))!;
    assert.equal(freshBinding.revision.generation, beforeGeneration + 2);
    await sql.transaction((c) =>
      syncMigratedDatasetLifecycle(c, "owner", ["Data01"]),
    );
    assert.equal(
      (await repository.binding(context, "data"))!.revision.generation,
      freshBinding.revision.generation,
    );
    assert.equal((await status())[1]!.deleted, false);
  } finally {
    await env.cleanup();
  }
});
