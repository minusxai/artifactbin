import test from "node:test";
import assert from "node:assert/strict";
import { decodeDatasetSqlOutcome } from "../src/datasets/sql/outcome.ts";
const job = {
  kind: "dataset-sql" as const,
  engineVersion: "sqlite-3.53.4-effect-v1" as const,
  input: {
    table: {
      schema: "main",
      name: "rows",
      columns: [{ name: "value", type: "number" as const }],
      rows: [{ value: 1 }],
    },
    sql: "update rows set value=2",
    params: {},
  },
};
const success = {
  rows: [{ value: 2 }],
  columns: job.input.table.columns,
  affected: 1,
  analysis: { operation: "update", columns: ["value"], functions: [] },
  userWrites: [],
};
test("fixed SQL result decoder accepts zero effects and explicit bounded errors", () => {
  const zero = decodeDatasetSqlOutcome(job, { ...success, affected: 0 });
  assert.ok("affected" in zero);
  assert.equal(zero.affected, 0);
  assert.deepEqual(
    decodeDatasetSqlOutcome(job, { error: "stopped", timedOut: true }),
    { error: "stopped", timedOut: true },
  );
});
test("decoded result cannot smuggle nonfinite/nested/undeclared cells or unsupported effect metadata", () => {
  for (const out of [
    { ...success, rows: [{ value: NaN }] },
    { ...success, rows: [{ value: { nested: 1 } }] },
    { ...success, rows: [{ value: 2, secret: "x" }] },
    { ...success, affected: -1 },
    { ...success, analysis: { ...success.analysis, operation: "replace" } },
    { ...success, continuation: { kind: "network" } },
    { error: "bad", continuation: { kind: "network" } },
  ])
    assert.throws(
      () => decodeDatasetSqlOutcome(job, out),
      /sql_invalid_result/,
    );
});
test("date/timestamp and actual user assignments retain typed scalar semantics", () => {
  const columns = [
    { name: "day", type: "date" as const },
    { name: "instant", type: "timestamp" as const },
    { name: "person", type: "user" as const },
  ];
  const typed = {
    ...job,
    input: { ...job.input, table: { ...job.input.table, columns, rows: [] } },
  };
  const row = {
    day: "2026-10-22",
    instant: "2026-10-22T00:00:00.000Z",
    person: "legacy-user",
  };
  const out = {
    rows: [row],
    columns,
    affected: 1,
    analysis: {
      operation: "insert",
      columns: ["day", "instant", "person"],
      functions: [],
    },
    userWrites: [{ person: "legacy-user" }],
  };
  assert.deepEqual(decodeDatasetSqlOutcome(typed, out), out);
  assert.throws(() =>
    decodeDatasetSqlOutcome(typed, {
      ...out,
      rows: [{ ...row, day: "2026-02-30" }],
    }),
  );
  assert.throws(() =>
    decodeDatasetSqlOutcome(typed, { ...out, userWrites: [{ person: 123 }] }),
  );
});
