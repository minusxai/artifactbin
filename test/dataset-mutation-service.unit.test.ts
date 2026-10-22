import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetMutationService } from "../src/datasets/mutation/service.ts";
import type {
  DatasetMutationPorts,
  DatasetMutationOperation,
} from "../src/datasets/mutation/contracts.ts";
const context = {
  backendId: "Back12",
  backendVersion: "a".repeat(64),
  pageId: "Page12",
  subject: "actor",
};
const operation: DatasetMutationOperation = {
  name: "save",
  backendId: context.backendId,
  backendVersion: context.backendVersion,
  page: { id: "Page12", version: 1, legacyId: "Legacy12", editId: "edit" },
  datasetId: "data",
  target: { schema: "public", table: "rows" },
  sql: "update public.rows set value=$value",
  paramTypes: { value: "number" },
  expectedAffected: 1,
  conflictMode: "refuse",
};
const request = {
  operation: "save",
  requestId: "abcdefghijklmnop",
  params: { value: 1 },
};
const columns = [{ name: "value", type: "number" as const }];
const object = { key: "b".repeat(64), sha256: "b".repeat(64), bytes: 13 };
function fixture() {
  const calls: string[] = [];
  const result = { affected: 1, rowCount: 1, version: 2, generation: 1 };
  const ports: DatasetMutationPorts = {
    async operation() {
      return operation;
    },
    async begin() {
      calls.push("begin");
      return { kind: "lease", lease: { id: "lease", attempt: 0 } };
    },
    async head() {
      return {
        generation: 0,
        version: 1,
        policyRevision: 0,
        writable: true,
        callerCanEdit: true,
        documentWriterCanRead: true,
        systemParams: {},
        tables: [{ schema: "public", name: "rows", columns, object }],
        authority: {
          pageVersion: 1,
          page: {
            id: "Legacy12",
            editId: "edit",
            owner: { userId: "owner", tokenId: null },
            visibility: "public",
            format: "markup",
            deleted: false,
            ownerIsTestUser: false,
            acceptedJoinUserIds: [],
          },
          dataset: {
            ...{ version: 1, generation: 1 },
            id: "data",
            owner: { userId: "owner", tokenId: null },
            visibility: "public",
            policyRevision: 0,
            ownerIsTestUser: false,
            deleted: false,
            policy: null,
          },
          facts: {
            caller: { userId: "owner", tokenId: null },
            identity: "user",
            groupRoles: {},
            sharedArtifactIds: [],
          },
        },
      };
    },
    async read() {
      return [{ value: 0 }];
    },
    async execute(job) {
      calls.push("execute");
      assert.equal(job.kind, "dataset-sql");
      return {
        rows: [{ value: 1 }],
        columns,
        affected: 1,
        analysis: { operation: "update", columns: ["value"], functions: [] },
      };
    },
    async persist() {
      calls.push("persist");
      return object;
    },
    async commit() {
      calls.push("commit");
      return { kind: "committed", result };
    },
    async refuse(_, code) {
      calls.push(code);
    },
  };
  return { ports, calls, result };
}
test("named server operation stores immutable object before atomic commit", async () => {
  const f = fixture();
  assert.deepEqual(
    await createDatasetMutationService(f.ports).mutate(context, request),
    f.result,
  );
  assert.deepEqual(f.calls, ["begin", "execute", "persist", "commit"]);
});
test("durable replay does not rerun SQL; CAS conflict never retries random/time effects", async () => {
  const f = fixture();
  f.ports.begin = async () => ({ kind: "replay", result: f.result });
  await createDatasetMutationService(f.ports).mutate(context, request);
  assert.deepEqual(f.calls, []);
  const g = fixture();
  g.ports.commit = async () => ({ kind: "conflict" });
  await assert.rejects(
    createDatasetMutationService(g.ports).mutate(context, request),
    /row_changed/,
  );
  assert.equal(g.calls.filter((x) => x === "execute").length, 1);
});
test("client SQL or authority overrides refuse before durable execution; unknown execution stays inflight", async () => {
  const f = fixture();
  await assert.rejects(
    createDatasetMutationService(f.ports).mutate(context, {
      ...request,
      sql: "delete from rows",
    }),
    /invalid_request/,
  );
  assert.deepEqual(f.calls, []);
  f.ports.execute = async () => {
    throw Error("transport lost");
  };
  await assert.rejects(
    createDatasetMutationService(f.ports).mutate(context, request),
    /transport lost/,
  );
  assert.deepEqual(f.calls, ["begin"]);
});
test("legacy identity system parameters cannot be forged by the browser", async () => {
  const f = fixture();
  await assert.rejects(
    createDatasetMutationService(f.ports).mutate(context, {
      ...request,
      params: { _me__id: "other" },
    }),
    /invalid_request/,
  );
  assert.deepEqual(f.calls, []);
});
test("known pre-execution authority and object failures become durable terminal refusals", async () => {
  const a = fixture();
  a.ports.head = async () => {
    throw Error("database offline");
  };
  await assert.rejects(
    createDatasetMutationService(a.ports).mutate(context, request),
    /authority_unavailable/,
  );
  assert.deepEqual(a.calls, ["begin", "authority_unavailable"]);
  const b = fixture();
  b.ports.read = async () => {
    throw Error("missing bytes");
  };
  await assert.rejects(
    createDatasetMutationService(b.ports).mutate(context, request),
    /dataset_unavailable/,
  );
  assert.deepEqual(b.calls, ["begin", "dataset_unavailable"]);
});
test("fixed caller budget reserves trusted system parameters before durable admission", async () => {
  for (const count of [239, 240, 241]) {
    const f = fixture();
    const params = Object.fromEntries(
      Array.from({ length: count }, (_, i) => ["p" + i, 1]),
    );
    const original = f.ports.head;
    f.ports.head = async (...args) => {
      const h = (await original(...args))!;
      return {
        ...h,
        systemParams: Object.fromEntries(
          Array.from({ length: 16 }, (_, i) => ["_me__" + i, 1]),
        ),
      };
    };
    f.ports.operation = async () => ({
      ...operation,
      paramTypes: Object.fromEntries(
        [
          ...Object.keys(params),
          ...Array.from({ length: 16 }, (_, i) => "_me__" + i),
        ].map((k) => [k, "number" as const]),
      ),
    });
    const result = createDatasetMutationService(f.ports).mutate(context, {
      ...request,
      params,
    });
    if (count <= 240) {
      await result;
      assert.ok(f.calls.includes("execute"));
    } else {
      await assert.rejects(result, /invalid_request/);
      assert.deepEqual(f.calls, []);
    }
  }
});
test("durable prior refusal replays without SQL or new refusal write", async () => {
  const f = fixture();
  f.ports.begin = async () => ({ kind: "refused", code: "row_changed" });
  await assert.rejects(
    createDatasetMutationService(f.ports).mutate(context, request),
    /row_changed/,
  );
  assert.deepEqual(f.calls, []);
});
test("trusted Import SQL alias changes only engine schema while canonical policy and CAS target stay fixed", async () => {
  const f = fixture();
  f.ports.operation = async () => ({
    ...operation,
    sqlSchema: "bookings",
    sql: "update bookings.rows set value=$value",
  });
  const execute = f.ports.execute,
    commit = f.ports.commit;
  f.ports.execute = async (job, signal) => {
    assert.equal(job.input.table.schema, "bookings");
    return execute(job, signal);
  };
  f.ports.commit = async (input) => {
    assert.deepEqual(input.operation.target, {
      schema: "public",
      table: "rows",
    });
    return commit(input);
  };
  await createDatasetMutationService(f.ports).mutate(context, request);
  await assert.rejects(
    createDatasetMutationService(f.ports).mutate(context, {
      ...request,
      sqlSchema: "forged",
    }),
    /invalid_request/,
  );
});

test("real SQLite alias keeps canonical restrictive policy, presets, checks and table isolation", async () => {
  const { createDatasetMutationEngine } = await import(
    "../src/datasets/sql/engine.ts"
  );
  const engine = await createDatasetMutationEngine();
  async function run(sql: string) {
    const f = fixture();
    const originalHead = f.ports.head;
    const cols = [
      { name: "id", type: "number" as const },
      { name: "who", type: "string" as const },
      { name: "value", type: "number" as const },
    ];
    f.ports.operation = async () => ({
      ...operation,
      target: { schema: "main", table: "rows" },
      sqlSchema: "sales",
      sql,
    });
    f.ports.head = async (...args) => {
      const h = await originalHead(...args);
      assert.ok(h);
      h.tables = [{ schema: "main", name: "rows", columns: cols, object }];
      h.authority.dataset.policy = {
        version: 1,
        enforcement: "enabled",
        tables: [
          {
            table: { schema: "main", name: "rows" },
            update_permissions: [
              {
                role: "viewer",
                permission: {
                  columns: ["value"],
                  filter: { who: { _eq: "x-hasura-user-id" } },
                  check: { value: { _gte: 0 } },
                  set: { who: "x-hasura-user-id", id: 7 },
                },
              },
            ],
          },
        ],
      };
      return h;
    };
    f.ports.read = async (table) => {
      assert.equal(table.schema, "main");
      return [
        { id: 1, who: "owner", value: 0 },
        { id: 2, who: "other", value: 0 },
      ];
    };
    f.ports.execute = async (job) => engine.mutate(job.input);
    f.ports.persist = async (rows) => {
      assert.deepEqual(rows, [
        { id: 7, who: "owner", value: 2 },
        { id: 2, who: "other", value: 0 },
      ]);
      return object;
    };
    const originalCommit = f.ports.commit;
    f.ports.commit = async (input) => {
      assert.deepEqual(input.operation.target, {
        schema: "main",
        table: "rows",
      });
      assert.equal(input.outcome.affected, 1);
      return originalCommit(input);
    };
    return createDatasetMutationService(f.ports).mutate(context, request);
  }
  await run("update sales.rows set value=(select count(*) from sales.rows)");
  await assert.rejects(run("update sales.rows set value=-1"), /policy_denied/);
  await assert.rejects(
    run("update sales.rows set who='other'"),
    /policy_denied/,
  );
  await assert.rejects(run("update main.rows set value=2"));
  await assert.rejects(run("update sales.other set value=2"));
});
