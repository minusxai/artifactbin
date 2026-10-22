import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./postgres.js";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createDatasetReadRepository } from "../src/persistence/datasets.ts";
import type { DatasetBinding } from "../src/datasets/contracts.ts";
const context = {
  backendId: "Bk0001",
  backendVersion: "backend-v1",
  pageId: "Pg0001",
  subject: "member",
};
const binding: DatasetBinding = {
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
test("trusted binding pins saved backend and page versions; authority refreshes current ACL, principals, joins and policy", async () => {
  const { env, repository } = await fixture();
  try {
    assert.deepEqual(await repository.binding(context, "sales"), binding);
    for (const change of [
      { backendVersion: "wrong" },
      { pageId: "wrong" },
      { backendId: "wrong" },
    ])
      assert.equal(
        await repository.binding({ ...context, ...change }, "sales"),
        null,
      );
    assert.equal(await repository.binding(context, "unknown"), null);
    const authority = await repository.authority(context, binding);
    assert.ok(authority);
    assert.deepEqual(authority.facts.caller, {
      userId: "old-member",
      tokenId: null,
    });
    assert.deepEqual(authority.page.acceptedJoinUserIds, ["old-member"]);
    assert.deepEqual([...authority.facts.sharedArtifactIds].sort(), [
      "old-data",
      "old-page",
    ]);
    await env.pool.query("DELETE FROM dataset_page_joins");
    assert.deepEqual(
      (await repository.authority(context, binding))?.page.acceptedJoinUserIds,
      [],
    );
    await env.pool.query(
      "UPDATE dataset_resources SET policy_revision=1,snapshot=jsonb_set(snapshot,'{policy}','{\"version\":2,\"allow\":[]}')",
    );
    const changed = await repository.authority(context, binding);
    assert.equal(changed?.dataset.policyRevision, 1);
    assert.deepEqual(changed?.dataset.policy, { version: 2, allow: [] });
    await env.pool.query("UPDATE dataset_resources SET deleted=true");
    assert.equal(await repository.authority(context, binding), null);
  } finally {
    await env.cleanup();
  }
});
test("separate page/dataset ACL, group revocation and ambiguous legacy callers fail closed; token ownership is never a credential", async () => {
  const { env, repository } = await fixture();
  try {
    assert.equal(
      await repository.authority({ ...context, subject: null }, binding),
      null,
    );
    await env.pool.query(
      "UPDATE dataset_resources SET access=jsonb_set(access,'{shares}','{}')",
    );
    assert.equal(await repository.authority(context, binding), null);
    await env.pool.query(
      "UPDATE dataset_resources SET access=jsonb_set(access,'{shares}','{\"member\":\"viewer\"}')",
    );
    await env.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{shares}','{}')",
    );
    assert.equal(await repository.authority(context, binding), null);
    await env.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{shares}','{\"member\":\"viewer\"}')",
    );
    await assert.rejects(
      env.pool.query(
        "INSERT INTO dataset_principals VALUES('legacy','member','user','ambiguous-second-user','user',NULL)",
      ),
      /unique/,
    );
    await env.pool.query("INSERT INTO accounts(actor) VALUES('other-member')");
    await assert.rejects(
      env.pool.query(
        "INSERT INTO dataset_principals VALUES('legacy','other-member','user','old-member','user',NULL)",
      ),
      /unique/,
    );
    await assert.rejects(
      env.pool.query(
        "UPDATE dataset_principals SET actor='owner' WHERE actor='member' AND kind='user'",
      ),
      /immutable/,
    );
    assert.ok(await repository.authority(context, binding));
    await assert.rejects(
      env.pool.query("UPDATE dataset_versions SET catalog='[]'"),
      /immutable/,
    );
    await env.pool.query("UPDATE files SET head='2'");
    assert.equal(await repository.binding(context, "sales"), null);
    assert.equal(await repository.authority(context, binding), null);
  } finally {
    await env.cleanup();
  }
});

test("fresh group memberships control dataset wrappers independently of the immutable pinned catalog", async () => {
  const { env, repository } = await fixture();
  try {
    await env.pool.query(
      "INSERT INTO accounts(actor,principal_kind) VALUES('group:qa','group')",
    );
    await env.pool.query("INSERT INTO groups(owner) VALUES('group:qa')");
    await env.pool.query(
      "INSERT INTO group_memberships VALUES('group:qa','member','viewer')",
    );
    await env.pool.query(
      "INSERT INTO dataset_groups VALUES('legacy','group:qa','old-group')",
    );
    await env.pool.query(
      "UPDATE dataset_resources SET owner='group:qa',access=jsonb_set(access,'{shares}','{}'),snapshot=jsonb_set(snapshot,'{owner}','{\"userId\":null,\"tokenId\":null,\"groupId\":\"old-group\"}')",
    );
    const authority = await repository.authority(context, binding);
    assert.ok(authority);
    assert.equal(authority.facts.groupRoles["old-group"], "viewer");
    await env.pool.query(
      "UPDATE dataset_resources SET current_version=2,policy_revision=1",
    );
    assert.equal(
      (await repository.binding(context, "sales"))?.dataset.version,
      1,
    );
    assert.equal(
      (await repository.authority(context, binding))?.dataset.policyRevision,
      1,
    );
    await env.pool.query(
      "DELETE FROM group_memberships WHERE owner='group:qa' AND actor='member'",
    );
    assert.equal(await repository.authority(context, binding), null);
  } finally {
    await env.cleanup();
  }
});

test("expired original users cannot regain source selectors through current account mapping", async () => {
  const { env, repository } = await fixture();
  try {
    await env.pool.query(
      "UPDATE dataset_principals SET expires_at=to_timestamp(0.1) WHERE kind='user' AND actor='member'",
    );
    assert.equal(await repository.authority(context, binding), null);
    await env.pool.query(
      "UPDATE dataset_principals SET expires_at=to_timestamp(0.101) WHERE kind='user' AND actor='member'",
    );
    assert.ok(await repository.authority(context, binding));
  } finally {
    await env.cleanup();
  }
});

test("deleting a page removes its binding metadata without rewriting the dataset catalog", async () => {
  const { env, repository } = await fixture();
  try {
    await env.pool.query("DELETE FROM files WHERE id='Pg0001'");
    assert.equal(await repository.binding(context, "sales"), null);
    assert.equal(
      (await env.pool.query("SELECT count(*)::int AS count FROM dataset_pages"))
        .rows[0].count,
      0,
    );
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*)::int AS count FROM dataset_page_joins",
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*)::int AS count FROM dataset_versions",
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await env.cleanup();
  }
});

