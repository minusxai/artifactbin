import { createServer } from "node:http";
import { createExecutionService } from "../src/backend/execution-service.ts";
import { remoteDatasetSqlExecutor } from "../src/backend/dataset-sql-transport.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDatasetSqlExecutor } from "../src/backend/dataset-sql-executor.ts";
const exec = promisify(execFile),
  namespace = "sqlproof";
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
async function noContainers() {
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
}
test("real fixed SQL container executes typed mutation, rejects malformed SQL and leaves no containers", async () => {
  const executor = createDatasetSqlExecutor({ deploymentNamespace: namespace });
  try {
    const service = createExecutionService({
      secret: "s".repeat(32),
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
    const port = (server.address() as { port: number }).port;
    const remote = remoteDatasetSqlExecutor({
      endpoint: `http://127.0.0.1:${port}/v1/execute`,
      secret: "s".repeat(32),
    });
    let out;
    try {
      out = await remote.execute(job);
    } finally {
      await remote.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
    assert.ok("affected" in out);
    assert.deepEqual(out.rows, [{ value: 2 }]);
    assert.equal(out.affected, 1);
    const failure = await executor.execute({
      ...job,
      input: { ...job.input, sql: "select * from rows" },
    });
    assert.ok("error" in failure);
    await noContainers();
  } finally {
    await executor.close();
    await noContainers();
  }
});
test("real SQL progress deadline stops unbounded recursive work; cancellation cleans container", async () => {
  const executor = createDatasetSqlExecutor({ deploymentNamespace: namespace });
  try {
    const started = Date.now();
    const out = await executor.execute({
      ...job,
      input: {
        ...job.input,
        sql: "update rows set value=(with recursive n(x) as (values(1) union all select x+1 from n) select sum(x) from n)",
      },
    });
    assert.ok("error" in out);
    assert.equal(out.timedOut, true);
    assert.ok(Date.now() - started < 14000);
    await noContainers();
    const abort = new AbortController();
    const call = executor.execute(
      {
        ...job,
        input: {
          ...job.input,
          sql: "update rows set value=(with recursive n(x) as (values(1) union all select x+1 from n) select sum(x) from n)",
        },
      },
      abort.signal,
    );
    setTimeout(() => abort.abort(), 300);
    await assert.rejects(call, /cancelled/);
    await noContainers();
  } finally {
    await executor.close();
    await noContainers();
  }
});
test("oversized jobs reject before Docker and missing fixed image fails without residue", async () => {
  const executor = createDatasetSqlExecutor({ deploymentNamespace: namespace });
  try {
    await assert.rejects(
      executor.execute({
        ...job,
        input: {
          ...job.input,
          table: { ...job.input.table, rows: Array(10001).fill({ value: 1 }) },
        },
      }),
      /invalid_job/,
    );
    await noContainers();
  } finally {
    await executor.close();
  }
  const missing = createDatasetSqlExecutor({
    deploymentNamespace: namespace,
    image: "missing-sql-fixed-engine:invalid",
  });
  try {
    await assert.rejects(missing.execute(job));
  } finally {
    await missing.close();
    await noContainers();
  }
});
