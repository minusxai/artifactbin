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

import {
  createDatasetMutationRepository,
  registerDatasetMutationOperations,
} from "../src/persistence/dataset-mutations.ts";
import { createDatasetMutationObjectStore } from "../src/datasets/mutation/object-store.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const operation = {
  name: "rename",
  backendId: context.backendId,
  backendVersion: context.backendVersion,
  page: binding.page,
  datasetId: binding.dataset.id,
  target: { schema: "public", table: "rows" },
  sql: "UPDATE rows SET name=$name",
  paramTypes: { name: "string" as const },
  conflictMode: "refuse" as const,
};
test("durable mutation commits history, receipt and invalidation atomically; concurrent stale heads cannot overwrite", async () => {
  const { env } = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "mutation-db-"));
  try {
    const database = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    const objects = createDatasetMutationObjectStore(directory);
    const repo = createDatasetMutationRepository({
      database,
      objects,
      now: () => 100,
    });
    await env.pool.query(
      "UPDATE dataset_resources SET writable=true,access=jsonb_set(access,'{shares}','{\"member\":\"editor\"}')",
    );
    await database.transaction((c) =>
      registerDatasetMutationOperations(c, [
        { sourceNamespace: "legacy", bindingName: "sales", operation },
      ]),
    );
    assert.equal(await repo.operation(context, "unknown"), null);
    const request = {
      operation: "rename",
      requestId: "one",
      params: { name: "new" },
    };
    const first = await repo.begin(context, operation, request);
    assert.equal(first.kind, "lease");
    if (first.kind !== "lease") throw Error();
    assert.deepEqual(await repo.begin(context, operation, request), {
      kind: "busy",
    });
    await assert.rejects(
      repo.begin(context, operation, { ...request, params: { name: "other" } }),
      { code: "request_id_conflict" },
    );
    const head = await repo.head(context, operation);
    assert.ok(head);
    const rows = [{ name: "new" }],
      stored = await objects.persist(rows);
    const outcome = {
      rows,
      columns: [...head.tables[0]!.columns],
      affected: 1,
      analysis: { operation: "update", columns: ["name"], functions: [] },
    } as import("../src/datasets/sql/engine/sql-contracts.ts").MutationResult;
    const second = await repo.begin(context, operation, {
      ...request,
      requestId: "two",
    });
    assert.equal(second.kind, "lease");
    if (second.kind !== "lease") throw Error();
    const results = await Promise.all(
      [first, second].map((start) =>
        repo.commit({
          context,
          operation,
          lease: start.lease,
          head,
          object: stored,
          outcome,
        }),
      ),
    );
    assert.deepEqual(results.map((x) => x.kind).sort(), [
      "committed",
      "conflict",
    ]);
    const winner = results.findIndex((x) => x.kind === "committed");
    const replay = await repo.begin(context, operation, {
      ...request,
      requestId: winner === 0 ? "one" : "two",
    });
    assert.equal(replay.kind, "replay");
    assert.deepEqual(
      (
        await env.pool.query(
          "SELECT current_version,generation FROM dataset_resources",
        )
      ).rows,
      [{ current_version: "2", generation: 2 }],
    );
    assert.equal(
      (await env.pool.query("SELECT count(*)::int n FROM dataset_versions"))
        .rows[0].n,
      2,
    );
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*)::int n FROM dataset_invalidations",
        )
      ).rows[0].n,
      1,
    );
    const pendingRequest = { ...request, requestId: "pending" };
    const pending = await repo.begin(context, operation, pendingRequest);
    assert.equal(pending.kind, "lease");
    if (pending.kind !== "lease") throw Error();
    const pendingHead = await repo.head(context, operation);
    assert.ok(pendingHead);
    await env.pool.query("UPDATE dataset_resources SET writable=false");
    assert.deepEqual(
      await repo.commit({
        context,
        operation,
        lease: pending.lease,
        head: pendingHead,
        object: stored,
        outcome,
      }),
      { kind: "denied" },
    );
    assert.deepEqual(
      await repo.commit({
        context,
        operation,
        lease: (winner === 0 ? first : second).lease,
        head,
        object: stored,
        outcome,
      }),
      { kind: "denied" },
    );
    await repo.refuse(pending.lease, "denied");
    await env.pool.query("UPDATE dataset_resources SET writable=true");
    assert.deepEqual(await repo.begin(context, operation, pendingRequest), {
      kind: "refused",
      code: "denied",
    });
    const uncertainRequest = { ...request, requestId: "uncertain" };
    const uncertain = await repo.begin(context, operation, uncertainRequest);
    assert.equal(uncertain.kind, "lease");
    if (uncertain.kind !== "lease") throw Error();
    const uncertainHead = await repo.head(context, operation);
    assert.ok(uncertainHead);
    await env.pool.query(
      "CREATE FUNCTION reject_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END $$",
    );
    await env.pool.query(
      "CREATE TRIGGER reject_invalidation BEFORE INSERT ON dataset_invalidations FOR EACH ROW EXECUTE FUNCTION reject_invalidation()",
    );
    await assert.rejects(
      repo.commit({
        context,
        operation,
        lease: uncertain.lease,
        head: uncertainHead,
        object: stored,
        outcome,
      }),
      /synthetic outbox failure/,
    );
    assert.equal(
      (await env.pool.query("SELECT current_version FROM dataset_resources"))
        .rows[0].current_version,
      "2",
    );
    assert.equal(
      (await env.pool.query("SELECT count(*)::int n FROM dataset_versions"))
        .rows[0].n,
      2,
    );
    assert.deepEqual(await repo.begin(context, operation, uncertainRequest), {
      kind: "busy",
    });
    await env.pool.query(
      "DROP TRIGGER reject_invalidation ON dataset_invalidations",
    );
    await env.pool.query("UPDATE dataset_resources SET writable=false");

    await assert.rejects(
      repo.begin(context, operation, {
        ...request,
        requestId: winner === 0 ? "one" : "two",
      }),
      { code: "denied" },
    );
  } finally {
    await env.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
