import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createDatasetReadRepository } from "../src/persistence/datasets.ts";
import type { DatasetBinding } from "../src/datasets/contracts.ts";
export const context = {
  backendId: "Bk0001",
  backendVersion: "backend-v1",
  pageId: "Pg0001",
  subject: "member",
};
export const binding: DatasetBinding = {
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
export async function fixture(savedBinding = binding) {
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
  const repository = createDatasetReadRepository(
    createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    }),
    () => 100,
  );
  return { env, repository };
}
