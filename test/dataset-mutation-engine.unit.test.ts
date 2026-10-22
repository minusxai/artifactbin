import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetMutationEngine } from "../src/datasets/sql/engine.ts";
const table = {
  schema: "items",
  name: "rows",
  columns: [
    { name: "id", type: "number" as const },
    { name: "who", type: "string" as const },
    { name: "value", type: "number" as const },
  ],
  rows: [
    { id: 1, who: "alice", value: 0 },
    { id: 2, who: "bob", value: 0 },
  ],
};
const permission = {
  table: { schema: "items", name: "rows" },
  update_permissions: [
    {
      role: "viewer",
      permission: {
        columns: ["value"],
        filter: { who: { _eq: "x-hasura-user-id" } },
        check: { value: { _gte: 0 } },
        set: { who: "x-hasura-user-id" },
      },
    },
  ],
};
test("actual write filter skips unauthorized rows while nested reads retain them; presets then checks apply", async () => {
  const engine = await createDatasetMutationEngine();
  const out = engine.mutate({
    table,
    sql: "update items.rows set value=(select count(*) from items.rows)",
    params: {},
    policy: {
      table: permission,
      role: "viewer",
      session: { "x-hasura-user-id": "alice" },
      operations: ["update"],
    },
  });
  assert.ok("affected" in out);
  assert.equal(out.affected, 1);
  assert.deepEqual(out.rows, [
    { id: 1, who: "alice", value: 2 },
    { id: 2, who: "bob", value: 0 },
  ]);
  const denied = engine.mutate({
    table,
    sql: "update items.rows set value=-1",
    params: {},
    policy: {
      table: permission,
      role: "viewer",
      session: { "x-hasura-user-id": "alice" },
      operations: ["update"],
    },
  });
  assert.ok("error" in denied);
  assert.equal(denied.code, "policy_denied");
});
test("actual cardinality and side effects refuse optimistic conflicts and REPLACE deletes", async () => {
  const engine = await createDatasetMutationEngine();
  const stale = engine.mutate({
    table,
    sql: "update items.rows set value=1 where id=99",
    params: {},
    expectedAffected: 1,
  });
  assert.ok("error" in stale);
  assert.equal(stale.code, "row_changed");
  const many = engine.mutate({
    table,
    sql: "update items.rows set value=1",
    params: {},
    expectedAffected: 1,
  });
  assert.ok("error" in many);
  assert.equal(many.code, "row_not_unique");
  const moved = engine.mutate({
    table,
    sql: "update items.rows set rowid=rowid+10",
    params: {},
  });
  assert.ok("error" in moved);
});
test("fixed job rejects caller code hooks and oversized row/column expansion before SQLite loading", async () => {
  const { validateDatasetSqlJob } = await import("../src/datasets/sql/job.ts");
  const job = {
    kind: "dataset-sql",
    engineVersion: "sqlite-3.53.4-effect-v1",
    input: { table, sql: "update items.rows set value=1", params: {} },
  };
  assert.throws(() => validateDatasetSqlJob({ ...job, entry: "evil.js" }));
  assert.throws(() =>
    validateDatasetSqlJob({
      ...job,
      input: { ...job.input, extensions: { code: "evil" } },
    }),
  );
  assert.throws(() =>
    validateDatasetSqlJob({
      ...job,
      input: { ...job.input, table: { ...table, rows: Array(10001).fill({}) } },
    }),
  );
});
test("INSERT named columns use actual defaults; presets precede SQL-null check and REPLACE effects are rejected", async () => {
  const engine = await createDatasetMutationEngine();
  const insertPolicy = {
    table: { schema: "items", name: "rows" },
    insert_permissions: [
      {
        role: "viewer",
        permission: {
          columns: ["id"],
          check: { value: { _gte: 0 } },
          set: { value: 7 },
        },
      },
    ],
  };
  const good = engine.mutate({
    table,
    sql: "insert into items.rows(id) values(3)",
    params: {},
    policy: {
      table: insertPolicy,
      role: "viewer",
      session: {},
      operations: ["insert"],
    },
  });
  assert.ok("affected" in good);
  assert.equal(good.affected, 1);
  assert.deepEqual(good.rows[2], { id: 3, who: null, value: 7 });
  const explicit = engine.mutate({
    table,
    sql: "insert into items.rows(id,value) values(3,0)",
    params: {},
    policy: {
      table: insertPolicy,
      role: "viewer",
      session: {},
      operations: ["insert"],
    },
  });
  assert.ok("error" in explicit);
  assert.equal(explicit.code, "policy_denied");
  const nullCheck = {
    ...insertPolicy,
    insert_permissions: [
      {
        role: "viewer",
        permission: { columns: "*" as const, check: { value: { _gte: 0 } } },
      },
    ],
  };
  const bad = engine.mutate({
    table,
    sql: "insert into items.rows(id) values(3)",
    params: {},
    policy: {
      table: nullCheck,
      role: "viewer",
      session: {},
      operations: ["insert"],
    },
  });
  assert.ok("error" in bad);
  assert.equal(bad.code, "policy_denied");
  const replaced = engine.mutate({
    table,
    sql: "insert or replace into items.rows(rowid,id) values(1,3)",
    params: {},
  });
  assert.ok("error" in replaced);
});
