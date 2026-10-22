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
test("combined user and system parameter budget is checked before execute with terminal admission refusal", async () => {
  for (const count of [255, 256]) {
    const f = fixture();
    const params = Object.fromEntries(
      Array.from({ length: count }, (_, i) => ["p" + i, 1]),
    );
    const original = f.ports.head;
    f.ports.head = async (...args) => {
      const h = (await original(...args))!;
      return { ...h, systemParams: { _now: "2026-01-01" } };
    };
    f.ports.operation = async () => ({
      ...operation,
      paramTypes: Object.fromEntries(
        [...Object.keys(params), "_now"].map((k) => [k, "number" as const]),
      ),
    });
    const result = createDatasetMutationService(f.ports).mutate(context, {
      ...request,
      params,
    });
    if (count === 255) {
      await result;
      assert.ok(f.calls.includes("execute"));
    } else {
      await assert.rejects(result, /invalid_job/);
      assert.deepEqual(f.calls, ["begin", "invalid_job"]);
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
