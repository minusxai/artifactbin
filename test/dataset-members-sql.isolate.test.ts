import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createExecutionService } from "../src/backend/execution-service.ts";
import { createDatasetSqlExecutor } from "../src/backend/dataset-sql-executor.ts";
import { remoteDatasetSqlExecutor } from "../src/backend/dataset-sql-transport.ts";
import type { DatasetSqlJob } from "../src/datasets/mutation/contracts.ts";
test(
  "remote fixed SQL controller exposes only the read-only accepted-members relation",
  { timeout: 30000 },
  async () => {
    const executor = createDatasetSqlExecutor({
      deploymentNamespace: "memberssql",
    });
    const secret = "s".repeat(32),
      server = createServer(
        createExecutionService({
          secret,
          datasetSql: executor,
          host: {
            compile: async () => {
              throw Error();
            },
            invoke: async () => {
              throw Error();
            },
          },
        }),
      );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const remote = remoteDatasetSqlExecutor({
      endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execute`,
      secret,
    });
    const job: DatasetSqlJob = {
      kind: "dataset-sql",
      engineVersion: "sqlite-3.53.4-effect-v1",
      input: {
        table: {
          schema: "main",
          name: "rows",
          columns: [
            { name: "who", type: "user" },
            { name: "value", type: "number" },
          ],
          rows: [
            { who: "accepted", value: 0 },
            { who: "not-joined", value: 0 },
          ],
        },
        reads: [
          {
            schema: "main",
            table: "_members",
            columns: [
              { name: "user_id", type: "user" },
              { name: "joined_at", type: "timestamp" },
            ],
            rows: [
              { user_id: "accepted", joined_at: "2020-01-01T00:00:00.000Z" },
            ],
          },
        ],
        sql: "UPDATE rows SET value=1 WHERE who IN(SELECT user_id FROM _members)",
        params: {},
        expectedAffected: 1,
      },
    };
    try {
      const out = await remote.execute(job);
      assert.ok("affected" in out);
      assert.equal(out.affected, 1);
      assert.deepEqual(out.rows, [
        { who: "accepted", value: 1 },
        { who: "not-joined", value: 0 },
      ]);
      const forbidden = await remote.execute({
        ...job,
        input: { ...job.input, sql: "DELETE FROM _members" },
      });
      assert.ok("error" in forbidden);
      await assert.rejects(
        remote.execute({
          ...job,
          input: {
            ...job.input,
            reads: [{ ...job.input.reads![0]!, table: "arbitrary" }],
          },
        }),
      );
    } finally {
      await remote.close();
      await executor.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
