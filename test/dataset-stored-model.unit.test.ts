import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDatasetReadService } from "../src/datasets/service.ts";
import type { RegisteredStoredModel } from "../src/datasets/stored-model/contracts.ts";
import type {
  DatasetReadRequest,
  DatasetResolvedBinding,
  DatasetReadAuthority,
  DatasetReadPorts,
} from "../src/datasets/contracts.ts";
const bytes = Buffer.from('[{"amount":1},{"amount":1},{"amount":2}]');
const sha256 = createHash("sha256").update(bytes).digest("hex");
const binding: DatasetResolvedBinding = {
  mode: "live",
  revision: { version: 2, generation: 1, policyRevision: 1 },
  name: "sales",
  backendId: "backend-file",
  backendVersion: "backend",
  page: { id: "document", version: 1, legacyId: "document", editId: "edit" },
  dataset: { id: "dataset", version: 2, policyRevision: 1 },
  tables: [
    {
      schema: "public",
      name: "rows",
      columns: [{ name: "amount", type: "number" }],
      object: {
        key: sha256,
        sha256,
        bytes: bytes.length,
      },
    },
  ],
};
const owner = { userId: "owner", tokenId: null };
const authority: DatasetReadAuthority = {
  pageVersion: 1,
  page: {
    id: "document",
    editId: "edit",
    owner,
    visibility: "public",
    format: "markup",
    deleted: false,
    ownerIsTestUser: false,
    acceptedJoinUserIds: [],
  },
  dataset: {
    id: "dataset",
    version: 2,
    generation: 1,
    deleted: false,
    owner,
    visibility: "public",
    policyRevision: 1,
    ownerIsTestUser: false,
    policy: null,
  },
  facts: {
    caller: { userId: null, tokenId: null },
    identity: null,
    groupRoles: {},
    sharedArtifactIds: [],
  },
};
const context = {
  backendId: "backend-file",
  backendVersion: "backend",
  pageId: "document",
  subject: null,
};
const request = {
  binding: "sales",
  schema: "public",
  table: "rows",
  offset: 0,
  limit: 1,
};
const model: RegisteredStoredModel = {
  datasetVersion: 2,
  sourceSha256: "a".repeat(64),
  schema: "public",
  table: "summary",
  columns: [
    { name: "amount", type: "number" },
    { name: "count", type: "number" },
  ],
  sql: "SELECT amount, COUNT(*) AS count FROM public.rows GROUP BY amount ORDER BY amount",
  dependencies: binding.tables,
};
const modelRequest: DatasetReadRequest = {
  ...request,
  table: "summary",
  limit: 1,
};
function fixture() {
  const a = structuredClone(authority),
    b = structuredClone(binding),
    m = structuredClone(model);
  let calls = 0;
  const ports: DatasetReadPorts = {
    binding: async () => b,
    authority: async () => a,
    read: async () =>
      (async function* () {
        yield bytes;
      })(),
    models: {
      resolve: async () => m,
      execute: async (job) => {
        calls++;
        assert.equal(job.input.tables[0]?.rows.length, 3);
        return {
          tables: {
            result: {
              columns: [...model.columns],
              rows: [
                { amount: 1, count: 2 },
                { amount: 2, count: 1 },
              ],
            },
          },
          errors: {},
        };
      },
    },
  };
  return {
    a,
    b,
    m,
    ports,
    calls: () => calls,
    read: (r = modelRequest) =>
      createDatasetReadService(ports).read(context, r),
  };
}
test("registered stored model transforms three physical rows to two typed model rows with pinned windows", async () => {
  const f = fixture();
  const first = await f.read();
  assert.deepEqual(first.rows, [{ amount: 1, count: 2 }]);
  assert.equal(first.totalRows, 2);
  assert.equal(first.nextOffset, 1);
  const second = await f.read({
    ...modelRequest,
    offset: 1,
    expectedVersion: first.version,
    expectedGeneration: first.generation,
  });
  assert.deepEqual(second.rows, [{ amount: 2, count: 1 }]);
  assert.equal(second.nextOffset, null);
});
test("model registration never bypasses custom policy, missing registration, or changed dataset", async () => {
  const f = fixture();
  f.a.dataset.policy = { version: 2, allow: [] };
  await assert.rejects(f.read(), /denied/);
  assert.equal(f.calls(), 0);
  const g = fixture();
  delete g.ports.models;
  await assert.rejects(g.read(), /denied/);
  const h = fixture();
  h.m.datasetVersion = 1;
  await assert.rejects(h.read(), /dataset_changed/);
});
test("dependencies must match exact attested physical objects and columns", async () => {
  const f = fixture();
  f.m.dependencies = structuredClone(f.m.dependencies);
  f.m.dependencies[0]!.object.sha256 = "b".repeat(64);
  await assert.rejects(f.read(), /invalid_dataset/);
  assert.equal(f.calls(), 0);
});
test("revocation during execution and stale continuation return no model rows", async () => {
  const f = fixture();
  const execute = f.ports.models!.execute;
  f.ports.models!.execute = async (...args) => {
    const result = await execute(...args);
    f.a.dataset.deleted = true;
    return result;
  };
  await assert.rejects(f.read(), /denied/);
  const g = fixture();
  await assert.rejects(
    g.read({
      ...modelRequest,
      offset: 1,
      expectedVersion: 1,
      expectedGeneration: 1,
    }),
    /dataset_changed/,
  );
});
test("truncated, erroneous, or schema-mismatched model answers fail explicitly", async () => {
  for (const answer of [
    {
      tables: {
        result: { columns: [...model.columns], rows: [], truncated: true },
      },
      errors: {},
    },
    { tables: {}, errors: { result: "private execution details" } },
    { tables: { result: { columns: [], rows: [] } }, errors: {} },
  ] as import("../src/datasets/query/contracts.ts").ServerQueryAnswer[]) {
    const f = fixture();
    f.ports.models!.execute = async () => answer;
    await assert.rejects(f.read(), /invalid_dataset|result_limit/);
  }
});

test("real bounded SQL engine computes registered aggregate rather than displaying physical rows", async () => {
  const { createDatasetQueryEngine } = await import(
    "../src/datasets/sql/read-engine.ts"
  );
  const engine = await createDatasetQueryEngine();
  const f = fixture();
  f.ports.models!.execute = async (job) => engine.query(job);
  const result = await f.read({ ...modelRequest, limit: 100 });
  assert.deepEqual(result.rows, [
    { amount: 1, count: 2 },
    { amount: 2, count: 1 },
  ]);
  assert.deepEqual(result.columns, model.columns);
});
test("model registration requires exact SQL, source marker, dependency hash and unchanged version", async () => {
  const { resolveStoredModelRegistration: resolve } = await import(
    "../src/datasets/stored-model/registration.ts"
  );
  const { storedModelDependenciesSha256: hash } = await import(
    "../src/datasets/stored-model/attestation.ts"
  );
  const attestation = {
    schema: model.schema,
    table: model.table,
    columns: model.columns,
    modelSqlSha256: createHash("sha256").update(model.sql).digest("hex"),
    sourceArtifactSha256: "a".repeat(64),
    dependencyDescriptorSha256: hash(binding.tables),
  };
  const snapshot = {
    ...authority.page,
    format: "dataset",
    standaloneDataset: {
      kind: "dataset-self-read-v1",
      datasetId: binding.dataset.id,
      version: binding.page.version,
      models: [attestation],
    },
  };
  const catalog = {
    kind: "stored",
    tables: [
      {
        schema: model.schema,
        name: model.table,
        columns: model.columns,
        sql: model.sql,
      },
    ],
  };
  assert.equal(
    resolve(binding, modelRequest, snapshot, catalog)?.sql,
    model.sql,
  );
  for (const bad of [
    {
      ...catalog,
      tables: [{ ...catalog.tables[0], sql: model.sql + " LIMIT 1" }],
    },
    { kind: "postgres", tables: catalog.tables },
  ])
    assert.equal(resolve(binding, modelRequest, snapshot, bad), null);
  assert.equal(
    resolve(
      { ...binding, revision: { ...binding.revision, version: 3 } },
      modelRequest,
      snapshot,
      catalog,
    ),
    null,
  );
  assert.equal(
    resolve(
      binding,
      modelRequest,
      {
        ...snapshot,
        standaloneDataset: {
          ...snapshot.standaloneDataset,
          models: [
            { ...attestation, dependencyDescriptorSha256: "b".repeat(64) },
          ],
        },
      },
      catalog,
    ),
    null,
  );
});
test("hostile model column metadata and text remain exact data and SQL cannot arrive in read request", async () => {
  const f = fixture();
  const name = "</script><script>unsafe()</script>";
  f.m.columns = [{ name, type: "string" }];
  f.ports.models!.execute = async () => ({
    tables: {
      result: {
        columns: [{ name, type: "string" }],
        rows: [{ [name]: "<unsafe>" }],
      },
    },
    errors: {},
  });
  assert.deepEqual((await f.read()).rows, [{ [name]: "<unsafe>" }]);
  await assert.rejects(
    createDatasetReadService(f.ports).read(context, {
      ...modelRequest,
      sql: "select 1",
    }),
    /invalid_request/,
  );
});
test("abort rejects a model execution that ignores cancellation and releases no rows", async () => {
  const f = fixture(),
    abort = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  f.ports.models!.execute = async () => {
    entered();
    return new Promise(() => {});
  };
  const result = createDatasetReadService(f.ports).read(
    context,
    modelRequest,
    abort.signal,
  );
  await started;
  abort.abort(new Error("cancelled"));
  await assert.rejects(result, /cancelled/);
});

test("empty model results are real empty windows; oversized cells never cross the capability frame", async () => {
  const f = fixture();
  f.ports.models!.execute = async () => ({
    tables: { result: { columns: [...model.columns], rows: [] } },
    errors: {},
  });
  const empty = await f.read();
  assert.equal(empty.totalRows, 0);
  assert.equal(empty.nextOffset, null);
  assert.deepEqual(empty.rows, []);
  const g = fixture();
  g.m.columns = [{ name: "text", type: "string" }];
  g.ports.models!.execute = async () => ({
    tables: {
      result: {
        columns: [...g.m.columns],
        rows: [{ text: "x".repeat(70000) }],
      },
    },
    errors: {},
  });
  await assert.rejects(g.read(), /result_limit/);
});
test("generation change during model execution discards the computed answer", async () => {
  const f = fixture(),
    execute = f.ports.models!.execute;
  f.ports.models!.execute = async (...args) => {
    const out = await execute(...args);
    f.a.dataset.generation++;
    return out;
  };
  await assert.rejects(f.read(), /dataset_changed/);
});
test("fixed model deadline aborts an unresponsive controller", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  let executionSignal: AbortSignal | undefined;
  f.ports.models!.execute = async (_job, signal) => {
    executionSignal = signal;
    entered();
    return new Promise(() => {});
  };
  const pending = f.read();
  await started;
  t.mock.timers.tick(10000);
  await assert.rejects(pending, /result_limit/);
  assert.equal(executionSignal?.aborted, true);
});
