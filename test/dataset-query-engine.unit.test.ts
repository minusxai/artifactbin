import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetQueryEngine } from "../src/datasets/sql/read-engine.ts";
import {
  validateDatasetQueryJob,
  decodeDatasetQueryAnswer,
} from "../src/datasets/sql/read-job.ts";
import type { DatasetQueryJob } from "../src/datasets/query/contracts.ts";
const job: DatasetQueryJob = {
  kind: "dataset-query",
  engineVersion: "sqlite-3.53.4-read-v1",
  input: {
    tables: [
      {
        schema: "bookings",
        table: "rows",
        columns: [{ name: "n", type: "number" }],
        rows: [{ n: 1 }, { n: 2 }],
      },
    ],
    params: { minimum: 2 },
    paramTypes: { minimum: "number" },
    queries: [
      {
        name: "filtered",
        sql: "select n from bookings.rows where n >= $minimum",
      },
      { name: "answer", sql: "select sum(n) as n from filtered" },
    ],
  },
};
test("read engine evaluates dependencies as whole named results with typed bindings", async () => {
  const engine = await createDatasetQueryEngine();
  const out = engine.query(job);
  assert.deepEqual(out.tables.answer?.rows, [{ n: 2 }]);
  assert.equal(Object.keys(out.errors).length, 0);
  assert.deepEqual(decodeDatasetQueryAnswer(job, out), out);
});
test("read engine refuses writes, file functions, catalogs, pragmas and multiple statements", async () => {
  const engine = await createDatasetQueryEngine();
  for (const sql of [
    "delete from bookings.rows returning n",
    "select readfile('/etc/passwd')",
    "select load_extension('/tmp/x')",
    "pragma database_list",
    "select * from sqlite_master",
    "select 1; select 2",
    "attach database '/tmp/x' as x",
  ]) {
    const out = engine.query({
      ...job,
      input: { ...job.input, queries: [{ name: "answer", sql }] },
    });
    assert.equal(typeof out.errors.answer, "string", sql);
    assert.equal(Object.keys(out.tables).length, 0);
  }
});
test("admission refuses malformed aliases, oversized jobs and arbitrary output fields", () => {
  assert.throws(() =>
    validateDatasetQueryJob({
      ...job,
      input: {
        ...job.input,
        tables: [{ ...job.input.tables[0], schema: "x;attach" }],
      },
    }),
  );
  assert.throws(() =>
    validateDatasetQueryJob({
      ...job,
      input: { ...job.input, params: { minimum: Infinity } },
    }),
  );
  assert.throws(() =>
    decodeDatasetQueryAnswer(job, { tables: {}, errors: {}, rawFile: "x" }),
  );
});
test("oversized dependencies fail closed rather than silently aggregating a truncated table", async () => {
  const engine = await createDatasetQueryEngine();
  const out = engine.query({
    ...job,
    input: {
      ...job.input,
      queries: [
        {
          name: "too_many",
          sql: "with recursive n(x) as (select 1 union all select x+1 from n where x<10001) select x from n",
        },
        { name: "answer", sql: "select count(*) from too_many" },
      ],
    },
  });
  assert.equal(out.errors.too_many, "query_failed");
  assert.equal(out.errors.answer, "query_failed");
  assert.equal(Object.keys(out.tables).length, 0);
  assert.throws(() =>
    decodeDatasetQueryAnswer(
      {
        ...job,
        input: { ...job.input, queries: [{ name: "answer", sql: "select 1" }] },
      },
      {
        tables: {
          answer: {
            columns: [{ name: "n", type: "number" }],
            rows: [{ n: "secret" }],
          },
        },
        errors: {},
      },
    ),
  );
});
test("unregistered SQL bindings including stale _me.role are refused instead of silently bound to NULL", async () => {
  const engine = await createDatasetQueryEngine();
  for (const parameter of ["_me__role", "undeclared"]) {
    const out = engine.query({
      ...job,
      input: {
        ...job.input,
        queries: [{ name: "answer", sql: `select $${parameter} as value` }],
      },
    });
    assert.equal(out.errors.answer, "unregistered_query_parameter");
    assert.equal(Object.hasOwn(out.tables, "answer"), false);
  }
});
