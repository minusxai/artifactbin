import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { fixture, binding, context } from "./dataset-runtime-fixture.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { createDatasetMutationObjectStore } from "../src/datasets/mutation/object-store.ts";
import { registerDatasetMutationOperations } from "../src/persistence/dataset-mutations.ts";
import { createDatasetRuntime } from "../src/server/dataset-runtime.ts";
import { createBackendHost } from "../src/backend/container-host.ts";
import { createExecutionService } from "../src/backend/execution-service.ts";
import { createDatasetSqlExecutor } from "../src/backend/dataset-sql-executor.ts";
import { remoteDatasetSqlExecutor } from "../src/backend/dataset-sql-transport.ts";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { createDatasetInvalidationReader } from "../src/persistence/dataset-invalidations.ts";
import { createBackendStoreInvalidationReader } from "../src/persistence/backend-store-invalidations.ts";
import { createLiveInvalidationConsumer } from "../src/live-invalidation.ts";
import { createBackendStore } from "../src/backend/af-store.ts";
test("isolate named mutation crosses authenticated SQL controller, persists overlay, refreshes live readers and replays durable notifications", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  const deployment = await host.compile(
    `export const typeDefs='type Query { change: JSON } scalar JSON';export default {Query:{change:(_args,_principal,caps)=>caps.dataset.mutate({operation:'rename',requestId:'runtime_request_0001',params:{name:'new'}})}}`,
  );
  const source = await mkdtemp(join(tmpdir(), "dataset-source-")),
    overlay = await mkdtemp(join(tmpdir(), "dataset-overlay-"));
  const original = createDatasetMutationObjectStore(source),
    object = await original.persist([{ name: "old" }]);
  const saved = {
    ...binding,
    backendVersion: deployment.version,
    tables: [{ ...binding.tables[0]!, object }],
  };
  const { env } = await fixture(saved);
  const database = createSqlDatabase({
    pool: env.pool,
    initialize: async () => {},
    statementTimeoutMs: 15000,
  });
  const sql = createDatasetSqlExecutor();
  const controller = createExecutionService({
    secret: "k".repeat(32),
    host,
    datasetSql: sql,
  });
  const server = createServer(controller);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const executor = remoteDatasetSqlExecutor({
    endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execute`,
    secret: "k".repeat(32),
  });
  const runtime = createDatasetRuntime({
    database,
    sourceDirectory: source,
    mutationDirectory: overlay,
    executor,
    now: () => 100,
  });
  const actual = { ...context, backendVersion: deployment.version };
  try {
    await env.pool.query(
      `UPDATE dataset_resources SET writable=true,access=jsonb_set(access,'{shares}','{"member":"editor"}')`,
    );
    await database.transaction((c) =>
      registerDatasetMutationOperations(c, [
        {
          sourceNamespace: "legacy",
          bindingName: "sales",
          operation: {
            name: "rename",
            backendId: actual.backendId,
            backendVersion: actual.backendVersion,
            page: binding.page,
            datasetId: binding.dataset.id,
            target: { schema: "public", table: "rows" },
            sql: "UPDATE rows SET name=$name",
            paramTypes: { name: "string" },
            conflictMode: "refuse",
          },
        },
      ]),
    );
    const capabilities = datasetCapabilityHandler(
      runtime.reads,
      actual,
      async () => {
        throw Error("connector denied");
      },
      runtime.mutations,
    );
    const invoke = () =>
      host.invoke({
        deployment,
        principal: { tenant: actual.pageId, subject: actual.subject },
        input: { field: "change", args: {} },
        capabilityHandler: capabilities,
        env: {},
        reuse: { kind: "one-shot" },
      });
    const result = await invoke();
    assert.deepEqual(result, {
      affected: 1,
      rowCount: 1,
      version: 2,
      generation: 2,
    });
    assert.deepEqual(await invoke(), result);
    const read = await runtime.reads.read(actual, {
      binding: "sales",
      schema: "public",
      table: "rows",
      offset: 0,
      limit: 10,
    });
    assert.deepEqual(read.rows, [{ name: "new" }]);
    assert.equal(read.version, 2);
    assert.equal(
      await readFile(join(source, object.key), "utf8"),
      '[{"name":"old"}]',
    );
    const notified: string[] = [];
    const reader = createDatasetInvalidationReader(database);
    const first = createLiveInvalidationConsumer({
      reader,
      autoStart: false,
      changed: (id) => {
        notified.push(id);
      },
    });
    await first.poll();
    assert.deepEqual(notified, ["Pg0001"]);
    await first.close();
    const second = createLiveInvalidationConsumer({
      reader,
      autoStart: false,
      changed: (id) => {
        notified.push(id);
      },
    });
    await second.poll();
    assert.deepEqual(notified, ["Pg0001", "Pg0001"]);
    await second.close();
    await createBackendStore(database).set(
      actual.backendId,
      { shared: true },
      0,
    );
    const storeEvents = await createBackendStoreInvalidationReader(
      database,
    ).after("0", 128);
    assert.deepEqual(
      storeEvents.map((e) => e.pageIds),
      [["Pg0001"]],
    );
    await env.pool.query(`UPDATE files SET head='2' WHERE id='Pg0001'`);
    assert.deepEqual(
      (await reader.after("0", 128)).map((e) => e.pageIds),
      [[]],
    );
    assert.deepEqual(
      (
        await createBackendStoreInvalidationReader(database).after("0", 128)
      ).map((e) => e.pageIds),
      [[]],
    );
    await assert.rejects(invoke());
  } finally {
    await runtime.close();
    await controller.close();
    await new Promise<void>((r) => server.close(() => r()));
    await env.cleanup();
    await rm(source, { recursive: true, force: true });
    await rm(overlay, { recursive: true, force: true });
  }
});
