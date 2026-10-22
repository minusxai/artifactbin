import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import {
  createDatasetMembersRepository,
  loadDatasetMembers,
  registerDatasetMemberBinding,
} from "../src/persistence/dataset-members.ts";
import type { DatasetBinding } from "../src/datasets/contracts.ts";
const context = {
  backendId: "Bk0001",
  backendVersion: "backend-v1",
  pageId: "Pg0001",
  subject: "member",
};
const binding: DatasetBinding = {
  mode: "live",
  name: "sales",
  backendId: "Bk0001",
  backendVersion: "backend-v1",
  page: { id: "Pg0001", version: 1, legacyId: "old-page", editId: "old-edit" },
  dataset: { id: "old-data", version: 1, policyRevision: 0 },
  tables: [
    {
      schema: "public",
      name: "rows",
      columns: [{ name: "name", type: "string" }],
      object: { key: "a".repeat(64), sha256: "a".repeat(64), bytes: 2 },
    },
  ],
};
async function fixture(savedBinding = binding) {
  const env = await testDatabase();
  for (const path of [
    "schema.sql",
    "backend/af-schema.sql",
    "datasets/schema.sql",
  ])
    await env.pool.query(
      await readFile(new URL("../src/" + path, import.meta.url), "utf8"),
    );
  await env.pool.query(
    "INSERT INTO accounts(actor) VALUES('owner'),('member')",
  );
  const access = {
    visibility: "private",
    linkRole: "viewer",
    shares: { member: "viewer" },
    version: 0,
  };
  await env.pool.query(
    "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Pg0001','owner','page',true,0)",
  );
  await env.pool.query(
    "INSERT INTO files(id,owner,share_hash,generation,head,access) VALUES('Pg0001','owner','hash',1,'1',$1)",
    [access],
  );
  await env.pool.query(
    "INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Bk0001','owner',$1)",
    [savedBinding.backendVersion],
  );
  await env.pool.query(
    "INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES('Bk0001',$1,'Pg0001',1,'type Query { read: String }','{}')",
    [savedBinding.backendVersion],
  );
  await env.pool.query(
    "INSERT INTO af_page_backends(page_id,page_version,position,name,file_id,version) VALUES('Pg0001',1,0,'bridge','Bk0001',$1)",
    [savedBinding.backendVersion],
  );
  const owner = { userId: "old-owner", tokenId: null };
  const page = {
    id: "old-page",
    editId: "old-edit",
    owner,
    visibility: "private",
    format: "markup",
    deleted: false,
    ownerIsTestUser: false,
    acceptedJoinUserIds: ["stale-user"],
  };
  const dataset = {
    id: "old-data",
    owner,
    visibility: "private",
    policyRevision: 0,
    ownerIsTestUser: false,
    policy: null,
  };
  await env.pool.query(
    "INSERT INTO dataset_resources(source_namespace,legacy_id,current_version,policy_revision,owner,generation,access,deleted,snapshot) VALUES('legacy','old-data',1,0,'owner',1,$1,false,$2)",
    [access, dataset],
  );
  await env.pool.query(
    "INSERT INTO dataset_versions VALUES('legacy','old-data',1,$1,'{}','[]')",
    [JSON.stringify(savedBinding.tables)],
  );
  await env.pool.query(
    "INSERT INTO dataset_pages VALUES('Pg0001',1,'legacy',$1)",
    [page],
  );
  const { tables: _, ...descriptor } = savedBinding;
  await env.pool.query(
    "INSERT INTO dataset_bindings VALUES('Bk0001',$2,'Pg0001',1,'sales','legacy','old-data',1,$1)",
    [descriptor, savedBinding.backendVersion],
  );
  await env.pool.query(
    "INSERT INTO dataset_principals VALUES('legacy','owner','user','old-owner','user',NULL),('legacy','member','user','old-member','user',NULL),('legacy','member','token','ownership-only-token','user',NULL)",
  );
  await env.pool.query(
    "INSERT INTO dataset_page_joins VALUES('Pg0001','legacy','old-member')",
  );
  await env.pool.query(
    "INSERT INTO dataset_member_bindings VALUES('Bk0001',$1,'Pg0001',1,'legacy')",
    [savedBinding.backendVersion],
  );
  const repository = createDatasetMembersRepository(
    createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    }),
    () => 100,
  );
  return { env, repository };
}
test("accepted members preserve timestamps/order and deny stale context, revocation and deletion", async () => {
  const { env, repository } = await fixture();
  try {
    const publication = {
      ...context,
      pageVersion: 1,
      sourceNamespace: "legacy",
    };
    await registerDatasetMemberBinding(env.pool, publication);
    await assert.rejects(
      registerDatasetMemberBinding(env.pool, {
        ...publication,
        sourceNamespace: "different",
      }),
      /Conflicting/,
    );
    assert.equal(
      await repository.snapshot(context),
      null,
      "unknown original timestamp is unavailable",
    );
    await env.pool.query(
      "UPDATE dataset_page_joins SET joined_at='2020-01-02T00:00:00Z'",
    );
    await env.pool.query(
      "INSERT INTO dataset_page_joins(page_id,source_namespace,legacy_user_id,joined_at) VALUES('Pg0001','legacy','earlier','2020-01-01T00:00:00Z')",
    );
    await env.pool.query("DELETE FROM dataset_bindings");
    const snapshot = await repository.snapshot(context);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.rows, [
      { user_id: "earlier", joined_at: "2020-01-01T00:00:00.000Z" },
      { user_id: "old-member", joined_at: "2020-01-02T00:00:00.000Z" },
    ]);
    assert.ok(
      !snapshot.rows.some((row) => row.user_id === "old-owner"),
      "owner is not an accepted join",
    );
    assert.equal(
      await repository.snapshot({ ...context, subject: null }),
      null,
    );
    assert.equal(
      await repository.snapshot({ ...context, backendVersion: "other" }),
      null,
    );
    await env.pool.query(
      "DELETE FROM dataset_page_joins WHERE legacy_user_id='earlier'",
    );
    assert.notEqual(
      (await repository.snapshot(context))?.generation,
      snapshot.generation,
    );
    await env.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{shares}','{}')",
    );
    assert.equal(await repository.snapshot(context), null);
    await env.pool.query("UPDATE files SET deleted_at=1");
    assert.equal(
      await repository.snapshot({ ...context, subject: "owner" }),
      null,
    );
  } finally {
    await env.cleanup();
  }
});
test("accepted-join insertion serializes against a captured page membership snapshot", async () => {
  const { env } = await fixture();
  const reader = await env.pool.connect(),
    writer = await env.pool.connect();
  try {
    await env.pool.query(
      "UPDATE dataset_page_joins SET joined_at='2020-01-01T00:00:00Z'",
    );
    await reader.query("BEGIN");
    const before = await loadDatasetMembers(reader, context, 100);
    assert.ok(before);
    await writer.query("BEGIN");
    await writer.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(
      writer.query(
        "INSERT INTO dataset_page_joins(page_id,source_namespace,legacy_user_id,joined_at) VALUES('Pg0001','legacy','new-join',now())",
      ),
      /lock timeout/,
    );
    await writer.query("ROLLBACK");
    await reader.query("COMMIT");
    await writer.query(
      "INSERT INTO dataset_page_joins(page_id,source_namespace,legacy_user_id,joined_at) VALUES('Pg0001','legacy','new-join',now())",
    );
    assert.notEqual(
      (await loadDatasetMembers(reader, context, 100))?.generation,
      before.generation,
    );
  } finally {
    await reader.query("ROLLBACK");
    await writer.query("ROLLBACK");
    reader.release();
    writer.release();
    await env.cleanup();
  }
});
