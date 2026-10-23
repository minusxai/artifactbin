import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createLegacyViewerBindingRepository } from "../src/persistence/legacy-viewer.ts";
test("legacy viewer compatibility requires one exact current live binding and matching backend pointer", async () => {
  const env = await testDatabase();
  try {
    await env.pool
      .query(`CREATE TABLE files(id text,head text,deleted_at timestamptz);
      CREATE TABLE dataset_viewer_bindings(backend_id text,backend_version text,page_id text,page_version int,source_namespace text);
      CREATE TABLE af_backend_pages(page_id text,page_version int);
      CREATE TABLE af_page_backends(page_id text,page_version int,file_id text,version text);
      INSERT INTO files VALUES('Page12','2',NULL);
      INSERT INTO af_backend_pages VALUES('Page12',2);
      INSERT INTO af_page_backends VALUES('Page12',2,'Back12','v1');
      INSERT INTO dataset_viewer_bindings VALUES('Back12','v1','Page12',1,'original');`);
    const repo = createLegacyViewerBindingRepository(
      createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},
        statementTimeoutMs: 1000,
      }),
    );
    const context = {
        pageId: "Page12",
        backendId: "Back12",
        backendVersion: "v1",
      },
      signal = new AbortController().signal;
    assert.equal(await repo.current(context, signal), false);
    await env.pool.query(
      "INSERT INTO dataset_viewer_bindings VALUES('Back12','v1','Page12',2,'original')",
    );
    assert.equal(await repo.current(context, signal), true);
    assert.equal(
      await repo.current({ ...context, backendVersion: "other" }, signal),
      false,
    );
    await env.pool.query("UPDATE af_backend_pages SET page_version=1");
    assert.equal(await repo.current(context, signal), false);
    await env.pool.query(
      "UPDATE af_backend_pages SET page_version=2;UPDATE af_page_backends SET version='wrong'",
    );
    assert.equal(await repo.current(context, signal), false);
    await env.pool.query(
      "UPDATE af_page_backends SET version='v1';UPDATE files SET deleted_at=now()",
    );
    assert.equal(await repo.current(context, signal), false);
  } finally {
    await env.cleanup();
  }
});
