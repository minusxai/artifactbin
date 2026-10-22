import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createDatasetPersonRepository } from "../src/persistence/dataset-person.ts";
test("person registry is pinned to a canonical current page deployment and keeps legacy cards separate from accounts", async () => {
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
      "INSERT INTO accounts(actor,name) VALUES('owner','Current account name'); INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Page12','owner','page',true,0); INSERT INTO files(id,owner,share_hash,generation,head) VALUES('Page12','owner','hash',1,'1'); INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Back12','owner','version'); INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES('Back12','version','Page12',1,'type Query { x: String }','{}'); INSERT INTO af_page_backends(page_id,page_version,position,name,file_id,version) VALUES('Page12',1,0,'legacyData','Back12','version');",
    );
    await env.pool.query(
      "INSERT INTO dataset_resources(source_namespace,legacy_id,current_version,policy_revision,owner,generation,access,deleted,snapshot) VALUES('legacy','data',1,0,'owner',1,'{}',false,'{}'); INSERT INTO dataset_versions VALUES('legacy','data',1,'[]','{}','[]'); INSERT INTO dataset_pages VALUES('Page12',1,'legacy','{}'); INSERT INTO dataset_bindings VALUES('Back12','version','Page12',1,'people','legacy','data',1,'{}');",
    );
    const binding = {
      sourceNamespace: "legacy",
      backendId: "Back12",
      backendVersion: "version",
      pageId: "Page12",
      pageVersion: 1,
      valueName: "selected",
      bindingName: "people",
      schema: "public",
      table: "rows",
      column: "who",
    };
    await env.pool.query(
      "INSERT INTO dataset_person_bindings VALUES('Back12','version','Page12',1,'selected','legacy',$1)",
      [binding],
    );
    await env.pool.query(
      "INSERT INTO dataset_public_profiles VALUES('legacy','original-user','Original public name','originalhandle',NULL)",
    );
    const repository = createDatasetPersonRepository(
        createSqlDatabase({
          pool: env.pool,
          initialize: async () => {},
          statementTimeoutMs: 15000,
        }),
      ),
      context = {
        backendId: "Back12",
        backendVersion: "version",
        pageId: "Page12",
        subject: "owner",
      };
    assert.deepEqual(await repository.binding(context, "selected"), binding);
    assert.deepEqual(await repository.card("legacy", "original-user"), {
      name: "Original public name",
      handle: "originalhandle",
      image: null,
    });
    assert.equal(await repository.card("other", "original-user"), null);
    assert.equal(
      await repository.binding(
        { ...context, backendVersion: "wrong" },
        "selected",
      ),
      null,
    );
    await env.pool.query("UPDATE files SET head='2'");
    assert.equal(await repository.binding(context, "selected"), null);
    assert.equal(
      (await env.pool.query("SELECT name FROM accounts WHERE actor='owner'"))
        .rows[0].name,
      "Current account name",
    );
  } finally {
    await env.cleanup();
  }
});
