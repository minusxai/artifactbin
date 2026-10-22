import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createExecutionService } from "../src/backend/execution-service.ts";
import { remoteDatasetSqlExecutor } from "../src/backend/dataset-sql-transport.ts";
import {
  SERVER_QUERY_LIMITS,
  type DatasetQueryJob,
} from "../src/datasets/query/contracts.ts";
const job: DatasetQueryJob = {
  kind: "dataset-query",
  engineVersion: "sqlite-3.53.4-read-v1",
  input: {
    tables: [],
    queries: [{ name: "answer", sql: "select $n as n" }],
    params: { n: 2 },
    paramTypes: { n: "number" },
  },
};
const answer = {
  tables: {
    answer: {
      rows: [{ n: 2 }],
      columns: [{ name: "n", type: "number" as const }],
    },
  },
  errors: {},
};
test("authenticated fixed query route transmits registered job, rejects crossed mutation job and closes cleanly", async () => {
  let calls = 0;
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
    datasetSql: {
      async execute() {
        throw Error("must_not_mutate");
      },
      async query(actual) {
        calls++;
        assert.deepEqual(actual, job);
        return answer;
      },
      async close() {},
    },
  });
  const server = createServer(service);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execute`;
  const client = remoteDatasetSqlExecutor({ endpoint, secret: "q".repeat(32) });
  try {
    assert.deepEqual(await client.query!(job), answer);
    const status = await new Promise<number>((resolve) => {
      const req = request(
        endpoint.replace("/v1/execute", "/v1/dataset-sql"),
        {
          method: "POST",
          headers: { authorization: "Bearer " + "q".repeat(32) },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.end(JSON.stringify(job));
    });
    assert.equal(status, 400);
    assert.equal(calls, 1);
    const denied = remoteDatasetSqlExecutor({
      endpoint,
      secret: "z".repeat(32),
    });
    await assert.rejects(denied.query!(job));
    await denied.close();
    assert.equal(calls, 1);
  } finally {
    await client.close();
    await service.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("query client rejects raw oversized reply and cancellation without accepting partial answers", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end(" ".repeat(SERVER_QUERY_LIMITS.outputBytes + 1));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const client = remoteDatasetSqlExecutor({
    endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execute`,
    secret: "q".repeat(32),
  });
  try {
    await assert.rejects(client.query!(job), /sql_output_limit/);
    await assert.rejects(client.query!(job, AbortSignal.abort()));
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
