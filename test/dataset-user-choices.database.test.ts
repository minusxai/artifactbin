import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createDatasetUserChoiceRepository } from "../src/persistence/dataset-user-choices.ts";
import { createDatasetUserChoiceService } from "../src/datasets/user-choices/service.ts";
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
      columns: [
        {
          name: "owner",
          type: "user",
          constraints: { memberOf: ["ref:old-scope"] },
        } as any,
      ],
      object: { key: "a".repeat(64), sha256: "a".repeat(64), bytes: 2 },
    },
  ],
};
async function fixture(savedBinding = binding, clock = () => 100) {
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
  await env.pool.query(
    "INSERT INTO accounts(actor) VALUES('joined'),('stranger')",
  );
  await env.pool.query(
    "INSERT INTO dataset_principals VALUES('legacy','joined','user','old-joined','user',NULL),('legacy','stranger','user','old-stranger','user',NULL)",
  );
  await env.pool.query(
    "INSERT INTO dataset_public_profiles VALUES('legacy','old-owner','Owner',NULL,NULL),('legacy','old-member','Member',NULL,NULL),('legacy','old-joined','Joined',NULL,NULL),('legacy','old-stranger','Stranger',NULL,NULL)",
  );
  await env.pool.query(
    "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Scope1','owner','page',true,0)",
  );
  await env.pool.query(
    "INSERT INTO files(id,owner,share_hash,generation,head,access) VALUES('Scope1','owner','hash',1,'1',$1)",
    [access],
  );
  await env.pool.query(
    "INSERT INTO dataset_pages VALUES('Scope1',1,'legacy',$1)",
    [{ ...page, id: "old-scope" }],
  );
  await env.pool.query(
    "INSERT INTO dataset_page_joins VALUES('Scope1','legacy','old-joined')",
  );
  await env.pool.query(
    "INSERT INTO dataset_user_choice_bindings VALUES('Bk0001','backend-v1','Pg0001',1,'legacy','items','owner',$1)",
    [
      {
        name: "items",
        column: "owner",
        bindingName: "sales",
        schema: "public",
        table: "rows",
        sourceColumn: "owner",
      },
    ],
  );
  const repository = createDatasetUserChoiceRepository(
    createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    }),
    {
      read: async () => ({
        version: 1,
        generation: 1,
        schema: "public",
        table: "rows",
        columns: [{ name: "owner", type: "user" }],
        rows: [],
        offset: 0,
        nextOffset: null,
        totalRows: 0,
      }),
    },
    clock,
  );
  return { env, repository };
}

test("cross-document constrained members include owner, accepted joins and named shares but no directory", async () => {
  const { env, repository } = await fixture();
  try {
    const service = createDatasetUserChoiceService(repository),
      request = { name: "items", column: "owner" };
    assert.deepEqual(await service.userChoices(context, request), [
      { value: "old-joined", label: "Joined" },
      { value: "old-member", label: "Member" },
      { value: "old-owner", label: "Owner" },
    ]);
    await env.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{shares}','{}') WHERE id='Scope1'",
    );
    assert.deepEqual(await service.userChoices(context, request), []);
    assert.deepEqual(
      await service.userChoices({ ...context, subject: "owner" }, request),
      [
        { value: "old-joined", label: "Joined" },
        { value: "old-owner", label: "Owner" },
      ],
    );
    await assert.rejects(
      service.userChoices({ ...context, backendVersion: "wrong" }, request),
      { code: "denied" },
    );
    await assert.rejects(
      service.userChoices(context, { ...request, column: "missing" }),
      { code: "denied" },
    );
  } finally {
    await env.cleanup();
  }
});
test("authenticated self intersects readable membership and never broadens an unreadable scope", async () => {
  for (const constraints of [
    { self: true },
    { self: true, memberOf: ["ref:old-scope"] },
    { self: true, memberOf: ["ref:missing"] },
    {},
  ]) {
    const saved = structuredClone(binding);
    (saved.tables[0]!.columns[0] as any).constraints = constraints;
    const { env, repository } = await fixture(saved);
    try {
      const result = await createDatasetUserChoiceService(
        repository,
      ).userChoices(context, { name: "items", column: "owner" });
      assert.deepEqual(
        result,
        "self" in constraints &&
          (!("memberOf" in constraints) ||
            constraints.memberOf?.[0] === "ref:old-scope")
          ? [{ value: "old-member", label: "Member" }]
          : [],
      );
    } finally {
      await env.cleanup();
    }
  }
});
test("scope access revoked between snapshots and non-user source columns fail closed", async () => {
  const { env, repository } = await fixture();
  try {
    let calls = 0;
    const service = createDatasetUserChoiceService({
      snapshot: async (...args) => {
        if (++calls === 2)
          await env.pool.query(
            "UPDATE files SET access=jsonb_set(access,'{shares}','{}') WHERE id='Scope1'",
          );
        return repository.snapshot(...args);
      },
    });
    await assert.rejects(
      service.userChoices(context, { name: "items", column: "owner" }),
      { code: "denied" },
    );
  } finally {
    await env.cleanup();
  }
  const saved = structuredClone(binding);
  (saved.tables[0]!.columns[0] as any).type = "string";
  const f = await fixture(saved);
  try {
    await assert.rejects(
      createDatasetUserChoiceService(f.repository).userChoices(context, {
        name: "items",
        column: "owner",
      }),
      { code: "denied" },
    );
  } finally {
    await f.env.cleanup();
  }
});

test("scope checks use one clock instant and dataset resource authority survives dual page representation", async () => {
  let time = 100;
  const { env, repository } = await fixture(binding, () => (time += 10));
  try {
    const access = {
      visibility: "private",
      linkRole: "viewer",
      shares: { member: "viewer" },
      version: 0,
    };
    const snapshot = {
      id: "old-scope",
      owner: { userId: "old-owner", tokenId: null },
      visibility: "private",
      policyRevision: 0,
      ownerIsTestUser: false,
      policy: null,
    };
    await env.pool.query(
      "INSERT INTO dataset_resources(source_namespace,legacy_id,current_version,policy_revision,owner,generation,access,deleted,snapshot) VALUES('legacy','old-scope',1,0,'owner',1,$1,false,$2)",
      [access, snapshot],
    );
    const service = createDatasetUserChoiceService(repository),
      request = { name: "items", column: "owner" };
    assert.deepEqual(await service.userChoices(context, request), [
      { value: "old-joined", label: "Joined" },
      { value: "old-member", label: "Member" },
      { value: "old-owner", label: "Owner" },
    ]);
    await env.pool.query(
      "UPDATE dataset_resources SET access=jsonb_set(access,'{shares}','{}') WHERE legacy_id='old-scope'",
    );
    assert.deepEqual(await service.userChoices(context, request), []);
  } finally {
    await env.cleanup();
  }
});
