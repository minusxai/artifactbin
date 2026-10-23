import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createHistoricalDatasetReplayRepository } from "../src/persistence/dataset-history.ts";
import { createPageService } from "../src/server/af-pages.ts";
import { createDatasetReadRepository } from "../src/persistence/datasets.ts";

test("historical standalone data reads exact immutable rows, preserves head-only live authority, and refuses revoked/missing registrations", async () => {
  const env = await testDatabase();
  try {
    for (const path of [
      "schema.sql",
      "backend/af-schema.sql",
      "datasets/schema.sql",
    ])
      await env.pool.query(
        await readFile(new URL("../src/" + path, import.meta.url), "utf8"),
      );
    await env.pool.query(
      "INSERT INTO accounts(actor) VALUES('owner'); INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Page01','owner','page',true,0); INSERT INTO files(id,owner,share_hash,generation,head,access) VALUES('Page01','owner','hash',1,'2','{\"visibility\":\"public\",\"linkRole\":\"viewer\",\"shares\":{},\"version\":0}'); INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Back01','owner','b'); INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES('Back01','b','Page01',1,'type Query { read: String }','{}'); INSERT INTO af_page_backends(page_id,page_version,position,name,file_id,version) VALUES('Page01',1,0,'legacyData','Back01','b')",
    );
    const bytes = Buffer.from(JSON.stringify([{ name: "archived only" }]));
    const key = createHash("sha256").update(bytes).digest("hex");
    const table = {
      schema: "main",
      name: "items",
      columns: [{ name: "name", type: "string" }],
      object: { key, sha256: key, bytes: bytes.length },
    };
    const owner = { userId: "old-owner", tokenId: null };
    const dataset = {
      id: "old-data",
      owner,
      visibility: "public",
      policyRevision: 0,
      ownerIsTestUser: false,
      policy: null,
    };
    const snapshot = {
      ...dataset,
      editId: "edit-one",
      format: "dataset",
      deleted: false,
      acceptedJoinUserIds: [],
      standaloneDataset: {
        kind: "dataset-self-read-v1",
        datasetId: "old-data",
        version: 1,
      },
    };
    const descriptor = {
      mode: "pinned",
      name: "data",
      backendId: "Back01",
      backendVersion: "b",
      page: {
        id: "Page01",
        version: 1,
        legacyId: "old-data",
        editId: "edit-one",
      },
      dataset: { id: "old-data", version: 1, policyRevision: 0 },
    };
    const access = {
      visibility: "public",
      linkRole: "viewer",
      shares: {},
      version: 0,
    };
    await env.pool.query(
      "INSERT INTO dataset_resources(source_namespace,legacy_id,current_version,policy_revision,owner,generation,access,deleted,snapshot) VALUES('legacy','old-data',2,0,'owner',1,$1,false,$2)",
      [access, dataset],
    );
    await env.pool.query(
      "INSERT INTO dataset_versions VALUES('legacy','old-data',1,$1,'{}','[]'),('legacy','old-data',2,'[]','{}','[]')",
      [JSON.stringify([table])],
    );
    await env.pool.query(
      "INSERT INTO dataset_pages VALUES('Page01',1,'legacy',$1)",
      [snapshot],
    );
    await env.pool.query(
      "INSERT INTO dataset_bindings VALUES('Back01','b','Page01',1,'data','legacy','old-data',1,$1)",
      [descriptor],
    );
    const db = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    let reads = 0;
    let revoke = false;
    const objects = {
      read: async (readKey: string) => {
        assert.equal(readKey, key);
        reads++;
        if (revoke)
          await env.pool.query(
            "UPDATE dataset_resources SET access=jsonb_set(access,'{visibility}','\"private\"'),generation=generation+1",
          );
        return (async function* () {
          yield bytes;
        })();
      },
    };
    const service = createHistoricalDatasetReplayRepository(
      db,
      objects,
      () => 100,
    );
    assert.equal(
      await createDatasetReadRepository(db).binding(
        {
          pageId: "Page01",
          backendId: "Back01",
          backendVersion: "b",
          subject: null,
        },
        "data",
      ),
      null,
    );
    const original =
      '<html><head><title>Dataset</title></head><body>Loading data…<script>throw Error("historical execution forbidden")</script></body></html>';
    await env.pool.query(
      "INSERT INTO sources(file_id,revision,content) VALUES('Page01','1',$1),('Page01','2',$1)",
      [original],
    );
    const pages = createPageService({
      database: db,
      authority: {
        account: () => {
          throw Error("anonymous");
        },
        issue: () => {
          throw Error("no historical session");
        },
      },
      pageModel: () => import("../src/page/page-model.ts"),
      backendFiles: async () => null,
      randomBytes: (n) => new Uint8Array(n),
      token: () => "",
      now: () => 100,
      historicalDatasetReplay: service,
    });
    const hosted = await pages.host(
      "",
      "Page01",
      "https://example.test",
      true,
      { kind: "saved", version: 1 },
    );
    assert.equal(hosted.source, original);
    assert.equal(hosted.boot.token, null);
    assert.equal(hosted.boot.permissions.edit, false);
    assert.equal(hosted.state.remote, null);
    assert.match(hosted.state.app!.rendered!, /archived only/);
    assert.equal(hosted.state.app!.sourceRevision, hosted.state.sourceRevision);
    const countBeforeSource = reads;
    const exactSource = await pages.host(
      "",
      "Page01",
      "https://example.test",
      false,
      { kind: "saved", version: 1 },
    );
    assert.equal(exactSource.source, original);
    assert.equal(exactSource.state.app, null);
    assert.equal(
      reads,
      countBeforeSource,
      "source representation performs no dataset reads",
    );
    reads = 0;
    const html = await service.render("Page01", 1, null);
    assert.match(html!, /archived only/);
    assert.match(html!, /version 1/);
    assert.equal(reads, 1);
    revoke = true;
    const revoked = await service.render("Page01", 1, null);
    assert.match(revoked!, /unavailable/);
    assert.doesNotMatch(revoked!, /archived only/);
    const count = reads;
    await service.render("Page01", 1, null);
    assert.equal(reads, count, "denied before object I/O");
    await env.pool.query("UPDATE dataset_resources SET access=$1", [access]);
    revoke = false;
    const unavailable = createHistoricalDatasetReplayRepository(
      db,
      {
        read: async () => {
          throw Error("archived object unavailable");
        },
      },
      () => 100,
    );
    const missing = await unavailable.render("Page01", 1, null);
    assert.match(missing!, /unavailable/);
    assert.doesNotMatch(missing!, /archived only/);
    assert.equal(reads, count);
    await env.pool.query("DELETE FROM dataset_bindings");
    assert.match((await service.render("Page01", 1, null))!, /unavailable/);
  } finally {
    await env.cleanup();
  }
});
