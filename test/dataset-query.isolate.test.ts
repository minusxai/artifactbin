import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createExecutionService } from "../src/backend/execution-service.ts";
import { createDatasetSqlExecutor } from "../src/backend/dataset-sql-executor.ts";
import { remoteDatasetSqlExecutor } from "../src/backend/dataset-sql-transport.ts";
import type { DatasetQueryJob } from "../src/datasets/query/contracts.ts";
const exec = promisify(execFile),
  namespace = "readproof";
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
    queries: [
      {
        name: "filtered",
        sql: "select n from bookings.rows where n >= $minimum",
      },
      { name: "answer", sql: "select sum(n) as n from filtered" },
    ],
    params: { minimum: 2 },
    paramTypes: { minimum: "number" },
  },
};
test("real isolated remote read query preserves registered aliases and dependencies, refuses effects and cleans up", async () => {
  const executor = createDatasetSqlExecutor({ deploymentNamespace: namespace });
  const service = createExecutionService({
    secret: "q".repeat(32),
    host: {
      async compile() {
        throw Error();
      },
      async invoke() {
        throw Error();
      },
    },
    datasetSql: executor,
  });
  const server = createServer(service);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const remote = remoteDatasetSqlExecutor({
    endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execute`,
    secret: "q".repeat(32),
  });
  try {
    const answer = await remote.query!(job);
    assert.deepEqual(answer.tables.answer?.rows, [{ n: 2 }]);
    assert.deepEqual(answer.errors, {});
    for (const sql of [
      "delete from bookings.rows returning n",
      "select readfile('/etc/passwd')",
      "select load_extension('/tmp/x')",
      "select * from sqlite_master",
    ]) {
      const refused = await remote.query!({
        ...job,
        input: { ...job.input, queries: [{ name: "answer", sql }] },
      });
      assert.deepEqual(refused.tables, {});
      assert.equal(refused.errors.answer, "query_failed");
    }
    const abort = new AbortController();
    const running = remote.query!(
      {
        ...job,
        input: {
          ...job.input,
          queries: [
            {
              name: "answer",
              sql: "with recursive n(x) as (select 1 union all select x+1 from n) select sum(x) from n",
            },
          ],
        },
      },
      abort.signal,
    );
    setTimeout(() => abort.abort(), 100);
    await assert.rejects(running);
  } finally {
    await remote.close();
    await service.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
  assert.equal(
    (
      await exec("docker", [
        "ps",
        "-aq",
        "--filter",
        `label=${namespace}.backend=1`,
      ])
    ).stdout.trim(),
    "",
  );
});
